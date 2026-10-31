<?php
/**
 * File helpers: supported formats, backups and moving uploads into place.
 *
 * @package LeanImages
 */

defined( 'ABSPATH' ) || exit;

const LEAN_IMAGES_BACKUP_META = '_lean_images_backup';

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
		return wp_get_original_image_url( $attachment_id );
	}
	if ( $backup ) {
		$location = lean_images_backup_location( $attachment_id );
		return $location['url'] . '/' . rawurlencode( $backup['files'][0] );
	}
	return wp_get_attachment_url( $attachment_id );
}

/**
 * Copy the full-size file and every sub-size aside, once, before the first
 * replacement, together with the metadata that describes them.
 *
 * @param int $attachment_id Attachment ID.
 * @return true|WP_Error
 */
function lean_images_backup( $attachment_id ) {
	if ( get_post_meta( $attachment_id, LEAN_IMAGES_BACKUP_META, true ) ) {
		return true; // Keep the very first state, not an earlier compression.
	}

	$file     = get_attached_file( $attachment_id );
	$meta     = wp_get_attachment_metadata( $attachment_id );
	$location = lean_images_backup_location( $attachment_id );
	$files    = array( wp_basename( $file ) );
	foreach ( isset( $meta['sizes'] ) ? $meta['sizes'] : array() as $size ) {
		$files[] = $size['file'];
	}
	$files = array_values( array_unique( $files ) );

	if ( ! wp_mkdir_p( $location['path'] ) ) {
		return new WP_Error( 'lean_images_backup_failed', __( 'Could not create the backup folder.', 'lean-images' ), array( 'status' => 500 ) );
	}
	foreach ( $files as $name ) {
		$from = path_join( dirname( $file ), $name );
		if ( file_exists( $from ) && ! copy( $from, path_join( $location['path'], $name ) ) ) {
			lean_images_delete_backup( $attachment_id );
			return new WP_Error( 'lean_images_backup_failed', __( 'Could not back up the current files.', 'lean-images' ), array( 'status' => 500 ) );
		}
	}

	update_post_meta(
		$attachment_id,
		LEAN_IMAGES_BACKUP_META,
		array(
			'files' => $files,
			'meta'  => $meta,
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
