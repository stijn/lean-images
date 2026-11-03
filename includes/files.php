<?php
/**
 * File helpers: supported formats, backups and moving uploads into place.
 *
 * @package LeanImages
 */

defined( 'ABSPATH' ) || exit;

const LEAN_IMAGES_BACKUP_META = '_lean_images_backup';
const LEAN_IMAGES_SAVED_META  = '_lean_images_saved';

/**
 * Output formats the browser can encode and this site accepts as uploads.
 *
 * @return string[] Mime types.
 */
function lean_images_formats() {
	$encodable = array(
		'jpg'  => 'image/jpeg',
		'webp' => 'image/webp',
		'avif' => 'image/avif',
		'png'  => 'image/png',
	);
	return array_values( array_intersect( $encodable, get_allowed_mime_types() ) );
}

/**
 * File extension for one of lean_images_formats().
 *
 * @param string $mime Mime type.
 * @return string
 */
function lean_images_extension( $mime ) {
	return 'image/jpeg' === $mime ? 'jpg' : substr( $mime, 6 );
}

/**
 * Whether an attachment is an image this plugin can work on.
 *
 * @param int $attachment_id Attachment ID.
 * @return bool
 */
function lean_images_is_supported( $attachment_id ) {
	return wp_attachment_is_image( $attachment_id )
		&& in_array( get_post_mime_type( $attachment_id ), lean_images_formats(), true );
}

/**
 * URL of the compress screen for an attachment.
 *
 * @param int $attachment_id Attachment ID.
 * @return string
 */
function lean_images_page_url( $attachment_id ) {
	return add_query_arg(
		array(
			'page'       => 'lean-images',
			'attachment' => (int) $attachment_id,
		),
		admin_url( 'upload.php' )
	);
}

/**
 * Every file WordPress serves for an attachment, in the format of that file:
 * the full size, each sub-size, and the WebP or AVIF copies that plugins such
 * as Modern Image Formats list under "sources". Sites that save sub-sizes in
 * another format than the upload (the image_editor_output_format filter) mix
 * formats too. Replacing overwrites exactly these files.
 *
 * @param int $attachment_id Attachment ID.
 * @return array[] Full size first. Each has size (a size name or "full"), file
 *                 (base name), width, height and mime.
 */
function lean_images_replace_targets( $attachment_id ) {
	$meta    = wp_get_attachment_metadata( $attachment_id );
	$entries = array(
		'full' => array(
			'file'    => wp_basename( get_attached_file( $attachment_id ) ),
			'width'   => $meta['width'],
			'height'  => $meta['height'],
			'sources' => isset( $meta['sources'] ) ? $meta['sources'] : array(),
		),
	) + ( isset( $meta['sizes'] ) ? $meta['sizes'] : array() );

	$targets = array();
	foreach ( $entries as $size => $entry ) {
		$files = array( $entry['file'] => wp_check_filetype( $entry['file'] )['type'] );
		foreach ( isset( $entry['sources'] ) ? $entry['sources'] : array() as $mime => $source ) {
			$files[ wp_basename( $source['file'] ) ] = $mime;
		}
		foreach ( $files as $file => $mime ) {
			// Two sizes can share a file. Formats the browser cannot encode stay as they are.
			if ( isset( $targets[ $file ] ) || ! in_array( $mime, lean_images_formats(), true ) ) {
				continue;
			}
			$targets[ $file ] = array(
				'size'   => $size,
				'file'   => $file,
				'width'  => (int) $entry['width'],
				'height' => (int) $entry['height'],
				'mime'   => $mime,
			);
		}
	}
	return array_values( $targets );
}

/**
 * Directory (and URL) holding the files saved before the first replacement.
 *
 * @param int $attachment_id Attachment ID.
 * @return array{path: string, url: string}
 */
function lean_images_backup_location( $attachment_id ) {
	$uploads = wp_upload_dir( null, false );
	$suffix  = '/lean-images-backup/' . (int) $attachment_id;
	return array(
		'path' => $uploads['basedir'] . $suffix,
		'url'  => $uploads['baseurl'] . $suffix,
	);
}

/**
 * URL of the best source to compress from: the untouched upload, never a file
 * this plugin already compressed (that would stack generation loss).
 *
 * @param int $attachment_id Attachment ID.
 * @return string
 */
function lean_images_source_url( $attachment_id ) {
	$meta   = wp_get_attachment_metadata( $attachment_id );
	$backup = get_post_meta( $attachment_id, LEAN_IMAGES_BACKUP_META, true );

	// Big uploads keep their pre-scaling original, which a replacement never touches.
	if ( ! empty( $meta['original_image'] ) ) {
		$url = wp_get_original_image_url( $attachment_id );
	} elseif ( $backup ) {
		$location = lean_images_backup_location( $attachment_id );
		$url      = $location['url'] . '/' . rawurlencode( $backup['files'][0] );
	} else {
		$url = wp_get_attachment_url( $attachment_id );
	}

	// WordPress only switches upload URLs to https on the front end. A site
	// whose address is stored as http:// would hand the https admin an http
	// URL, and browsers refuse to download that from a secure page.
	return set_url_scheme( $url );
}

/**
 * Copy every file a replacement overwrites aside, together with the metadata
 * that describes them. The backup keeps the very first state, not an earlier
 * compression: a later replacement only adds files the backup does not have
 * yet, which are still untouched.
 *
 * @param int $attachment_id Attachment ID.
 * @return true|WP_Error
 */
function lean_images_backup( $attachment_id ) {
	$backup   = get_post_meta( $attachment_id, LEAN_IMAGES_BACKUP_META, true );
	$known    = $backup ? $backup['files'] : array();
	$new      = array_values( array_diff( wp_list_pluck( lean_images_replace_targets( $attachment_id ), 'file' ), $known ) );
	$dir      = dirname( get_attached_file( $attachment_id ) );
	$location = lean_images_backup_location( $attachment_id );
	if ( ! $new ) {
		return true;
	}

	if ( ! wp_mkdir_p( $location['path'] ) ) {
		return new WP_Error( 'lean_images_backup_failed', __( 'Could not create the backup folder.', 'lean-images' ), array( 'status' => 500 ) );
	}
	foreach ( $new as $name ) {
		$from = path_join( $dir, $name );
		if ( file_exists( $from ) && ! copy( $from, path_join( $location['path'], $name ) ) ) {
			if ( ! $backup ) {
				lean_images_delete_backup( $attachment_id );
			}
			return new WP_Error( 'lean_images_backup_failed', __( 'Could not back up the current files.', 'lean-images' ), array( 'status' => 500 ) );
		}
	}

	update_post_meta(
		$attachment_id,
		LEAN_IMAGES_BACKUP_META,
		array(
			'files' => array_merge( $known, $new ),
			'meta'  => $backup ? $backup['meta'] : wp_get_attachment_metadata( $attachment_id ),
		)
	);
	return true;
}

/**
 * Put the backed-up files and metadata back.
 *
 * @param int $attachment_id Attachment ID.
 * @return true|WP_Error
 */
function lean_images_restore( $attachment_id ) {
	$backup = get_post_meta( $attachment_id, LEAN_IMAGES_BACKUP_META, true );
	if ( ! $backup ) {
		return new WP_Error( 'lean_images_no_backup', __( 'There is no backup for this image.', 'lean-images' ), array( 'status' => 404 ) );
	}

	$location = lean_images_backup_location( $attachment_id );
	$dir      = dirname( get_attached_file( $attachment_id ) );
	foreach ( $backup['files'] as $name ) {
		$name = wp_basename( $name );
		$from = path_join( $location['path'], $name );
		if ( file_exists( $from ) && ! copy( $from, path_join( $dir, $name ) ) ) {
			return new WP_Error( 'lean_images_restore_failed', __( 'Could not restore the files.', 'lean-images' ), array( 'status' => 500 ) );
		}
	}

	wp_update_attachment_metadata( $attachment_id, $backup['meta'] );
	lean_images_delete_backup( $attachment_id );
	delete_post_meta( $attachment_id, LEAN_IMAGES_SAVED_META );
	return true;
}

/**
 * Remove an attachment's backup files and record.
 *
 * @param int $attachment_id Attachment ID.
 */
function lean_images_delete_backup( $attachment_id ) {
	$location = lean_images_backup_location( $attachment_id );
	foreach ( (array) glob( $location['path'] . '/*' ) as $path ) {
		wp_delete_file( $path );
	}
	if ( is_dir( $location['path'] ) ) {
		rmdir( $location['path'] );
	}
	delete_post_meta( $attachment_id, LEAN_IMAGES_BACKUP_META );
}
add_action( 'delete_attachment', 'lean_images_delete_backup' );

/**
 * Move an uploaded file into place with the uploads folder's permissions.
 *
 * @param string $tmp  Uploaded temp file.
 * @param string $dest Destination path; overwritten if it exists.
 * @return bool
 */
function lean_images_move_upload( $tmp, $dest ) {
	// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- Failure is reported to the caller.
	if ( ! @move_uploaded_file( $tmp, $dest ) ) {
		return false;
	}
	$stat = stat( dirname( $dest ) );
	chmod( $dest, $stat['mode'] & 0000666 );
	return true;
}
