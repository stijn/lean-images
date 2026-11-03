<?php
/**
 * Keep the browser-encoded files when WordPress rebuilds an image's sizes.
 *
 * Bulk tools such as Regenerate Thumbnails and `wp media regenerate` call
 * wp_generate_attachment_metadata(), which scales the full size and makes
 * every sub-size again from the original with GD or Imagick, overwriting the
 * files Lean Images saved. For images Lean Images saved, those files stay and
 * WordPress only makes the sizes they do not cover, such as a size a new
 * theme registers.
 *
 * @package LeanImages
 */

defined( 'ABSPATH' ) || exit;

/**
 * Note the metadata Lean Images just saved, which lists every file it wrote.
 *
 * @param int $attachment_id Attachment ID.
 */
function lean_images_remember_files( $attachment_id ) {
	update_post_meta( $attachment_id, LEAN_IMAGES_SAVED_META, wp_get_attachment_metadata( $attachment_id, true ) );
}

/**
 * The metadata of the last Lean Images save, if WordPress still serves that
 * full-size file unchanged. Another tool may have put other files in place
 * since: WordPress' own image editor, or an optimiser that rewrote the file.
 *
 * Decided once per request, before a rebuild starts switching files.
 *
 * @param int $attachment_id Attachment ID.
 * @return array|null
 */
function lean_images_saved_files( $attachment_id ) {
	static $saved = array();
	if ( ! array_key_exists( $attachment_id, $saved ) ) {
		$meta = get_post_meta( $attachment_id, LEAN_IMAGES_SAVED_META, true );
		$file = get_attached_file( $attachment_id );
		$intact = is_array( $meta ) && ! empty( $meta['file'] ) && ! empty( $meta['filesize'] )
			&& get_post_meta( $attachment_id, '_wp_attached_file', true ) === $meta['file']
			&& wp_filesize( $file ) === (int) $meta['filesize'];
		$saved[ $attachment_id ] = $intact ? $meta : null;
	}
	return $saved[ $attachment_id ];
}

/**
 * Whether WordPress is building an attachment's sizes from scratch right now.
 * The filters below also run elsewhere, for example when the editor asks
 * for the scaling threshold, and must leave those calls alone.
 *
 * @return bool
 */
function lean_images_creating_subsizes() {
	// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_debug_backtrace -- Looks for the caller only.
	foreach ( debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS, 8 ) as $frame ) {
		if ( 'wp_create_image_subsizes' === $frame['function'] ) {
			return true;
		}
	}
	return false;
}

/**
 * Sizes kept from the last Lean Images save during the current rebuild.
 *
 * @param int        $attachment_id Attachment ID.
 * @param array|null $add           Size names to add.
 * @return string[]
 */
function lean_images_kept_sizes( $attachment_id, $add = null ) {
	static $kept = array();
	if ( null !== $add ) {
		$kept[ $attachment_id ] = $add;
	}
	return isset( $kept[ $attachment_id ] ) ? $kept[ $attachment_id ] : array();
}

// Scaling would overwrite the full size with a GD or Imagick version.
add_filter(
	'big_image_size_threshold',
	function ( $threshold, $imagesize = null, $file = null, $attachment_id = 0 ) {
		return $attachment_id && lean_images_creating_subsizes() && lean_images_saved_files( $attachment_id ) ? false : $threshold;
	},
	1000,
	4
);

// Leave out the sub-sizes whose saved file is still there, unchanged, at the
// dimensions WordPress would give that size now.
add_filter(
	'intermediate_image_sizes_advanced',
	function ( $sizes, $image_meta = null, $attachment_id = 0 ) {
		$saved = $attachment_id && lean_images_creating_subsizes() ? lean_images_saved_files( $attachment_id ) : null;
		if ( ! $saved || empty( $saved['sizes'] ) || ! is_array( $sizes ) ) {
			return $sizes;
		}
		// WordPress sizes the sub-sizes from the file it is working from, the
		// original upload when there is one.
		$width  = empty( $image_meta['width'] ) ? $saved['width'] : $image_meta['width'];
		$height = empty( $image_meta['height'] ) ? $saved['height'] : $image_meta['height'];
		$dir    = dirname( get_attached_file( $attachment_id ) );
		$kept   = array();
		foreach ( $sizes as $name => $size ) {
			if ( empty( $saved['sizes'][ $name ] ) ) {
				continue;
			}
			$file = $saved['sizes'][ $name ];
			$dims = image_resize_dimensions( $width, $height, $size['width'], $size['height'], $size['crop'] );
			if (
				$dims && (int) $file['width'] === $dims[4] && (int) $file['height'] === $dims[5]
				&& ! empty( $file['filesize'] ) && wp_filesize( path_join( $dir, $file['file'] ) ) === (int) $file['filesize']
			) {
				$kept[] = $name;
				unset( $sizes[ $name ] );
			}
		}
		lean_images_kept_sizes( $attachment_id, $kept );
		return $sizes;
	},
	1000,
	3
);

// Put the saved full size and the kept sub-sizes back into the new metadata.
// Runs after plugins that add their own copies, so theirs of these files go.
add_filter(
	'wp_generate_attachment_metadata',
	function ( $metadata, $attachment_id = 0 ) {
		$saved = $attachment_id ? lean_images_saved_files( $attachment_id ) : null;
		if ( ! $saved || ! is_array( $metadata ) ) {
			return $metadata;
		}
		foreach ( array( 'file', 'width', 'height', 'filesize', 'original_image', 'sources' ) as $key ) {
			if ( isset( $saved[ $key ] ) ) {
				$metadata[ $key ] = $saved[ $key ];
			} else {
				unset( $metadata[ $key ] );
			}
		}
		foreach ( lean_images_kept_sizes( $attachment_id ) as $name ) {
			$metadata['sizes'][ $name ] = $saved['sizes'][ $name ];
		}
		// WordPress may have switched to a rotated copy of the original.
		update_attached_file( $attachment_id, $saved['file'] );
		return $metadata;
	},
	1000,
	2
);
