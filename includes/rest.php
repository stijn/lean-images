<?php
/**
 * REST endpoints that receive images encoded in the browser.
 *
 * The browser sends the full-size image plus every sub-size, already encoded,
 * so WordPress never re-encodes them with GD or Imagick (which would undo the
 * tuning).
 *
 * @package LeanImages
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'rest_api_init',
	function () {
		$id = array(
			'type'     => 'integer',
			'required' => true,
		);

		register_rest_route(
			'lean-images/v1',
			'/attachments/(?P<id>\d+)/save',
			array(
				'methods'             => 'POST',
				'callback'            => 'lean_images_rest_save',
				'permission_callback' => 'lean_images_rest_permission',
				'args'                => array(
					'id'    => $id,
					'mode'  => array(
						'type'     => 'string',
						'enum'     => array( 'new', 'replace' ),
						'required' => true,
					),
					'sizes' => array(
						'type'    => 'string',
						'default' => '{}',
					),
				),
			)
		);

		register_rest_route(
			'lean-images/v1',
			'/attachments/(?P<id>\d+)/restore',
			array(
				'methods'             => 'POST',
				'callback'            => 'lean_images_rest_restore',
				'permission_callback' => 'lean_images_rest_permission',
				'args'                => array( 'id' => $id ),
			)
		);
	}
);

/**
 * Only people who may upload files and edit this image.
 *
 * @param WP_REST_Request $request Request.
 * @return bool
 */
function lean_images_rest_permission( WP_REST_Request $request ) {
	$attachment_id = (int) $request['id'];
	return current_user_can( 'upload_files' )
		&& current_user_can( 'edit_post', $attachment_id )
		&& lean_images_is_supported( $attachment_id );
}

/**
 * POST /lean-images/v1/attachments/{id}/save
 *
 * @param WP_REST_Request $request Request with `full` and `sub_N` files.
 * @return array|WP_Error
 */
function lean_images_rest_save( WP_REST_Request $request ) {
	$attachment_id = (int) $request['id'];
	$mode          = $request['mode'];
	$files         = $request->get_file_params();
	$size_names    = json_decode( $request['sizes'], true );

	if ( empty( $files['full'] ) ) {
		return new WP_Error( 'lean_images_no_file', __( 'No image was uploaded.', 'lean-images' ), array( 'status' => 400 ) );
	}
	$full = lean_images_check_upload( $files['full'] );
	if ( is_wp_error( $full ) ) {
		return $full;
	}

	$meta    = wp_get_attachment_metadata( $attachment_id );
	$allowed = 'replace' === $mode
		? array_keys( isset( $meta['sizes'] ) ? $meta['sizes'] : array() )
		: array_keys( wp_get_registered_image_subsizes() );

	$subsizes = array();
	foreach ( is_array( $size_names ) ? $size_names : array() as $field => $name ) {
		if ( ! preg_match( '/^sub_\d+$/', $field ) || empty( $files[ $field ] ) || ! in_array( $name, $allowed, true ) ) {
			return new WP_Error( 'lean_images_bad_size', __( 'Unexpected image size in the upload.', 'lean-images' ), array( 'status' => 400 ) );
		}
		$checked = lean_images_check_upload( $files[ $field ], $full['mime'] );
		if ( is_wp_error( $checked ) ) {
			return $checked;
		}
		$subsizes[ $name ] = $checked;
	}

	return 'replace' === $mode
		? lean_images_replace_files( $attachment_id, $full, $subsizes )
		: lean_images_create_attachment( $attachment_id, $full, $subsizes );
}

/**
 * POST /lean-images/v1/attachments/{id}/restore
 *
 * @param WP_REST_Request $request Request.
 * @return array|WP_Error
 */
function lean_images_rest_restore( WP_REST_Request $request ) {
	$restored = lean_images_restore( (int) $request['id'] );
	return is_wp_error( $restored ) ? $restored : array( 'restored' => true );
}

/**
 * Validate one uploaded image by its actual content, not its name.
 *
 * @param array       $file          Entry from $_FILES.
 * @param string|null $expected_mime Mime type it must have.
 * @return array{tmp: string, mime: string, width: int, height: int}|WP_Error
 */
function lean_images_check_upload( $file, $expected_mime = null ) {
	if ( ! empty( $file['error'] ) || empty( $file['tmp_name'] ) || ! is_uploaded_file( $file['tmp_name'] ) ) {
		return new WP_Error( 'lean_images_upload_failed', __( 'The upload did not arrive. The images may exceed the server’s upload limits.', 'lean-images' ), array( 'status' => 400 ) );
	}

	$info = wp_getimagesize( $file['tmp_name'] );
	if ( ! $info || ! in_array( $info['mime'], lean_images_formats(), true ) ) {
		return new WP_Error( 'lean_images_not_image', __( 'The upload is not a supported image.', 'lean-images' ), array( 'status' => 400 ) );
	}
	if ( $expected_mime && $info['mime'] !== $expected_mime ) {
		return new WP_Error( 'lean_images_mixed_formats', __( 'All sizes must use the same format.', 'lean-images' ), array( 'status' => 400 ) );
	}

	return array(
		'tmp'    => $file['tmp_name'],
		'mime'   => $info['mime'],
		'width'  => (int) $info[0],
		'height' => (int) $info[1],
	);
}

/**
 * Store the result as a new attachment, keeping the original untouched.
 *
 * @param int   $source_id Attachment the image was compressed from.
 * @param array $full      Checked full-size upload.
 * @param array $subsizes  Checked sub-size uploads keyed by size name.
 * @return array|WP_Error
 */
function lean_images_create_attachment( $source_id, $full, $subsizes ) {
	$uploads = wp_upload_dir();
	if ( ! empty( $uploads['error'] ) ) {
		return new WP_Error( 'lean_images_uploads_dir', $uploads['error'], array( 'status' => 500 ) );
	}

	$ext      = lean_images_extension( $full['mime'] );
	$base     = preg_replace( '/-scaled$/', '', pathinfo( get_attached_file( $source_id ), PATHINFO_FILENAME ) );
	$filename = wp_unique_filename( $uploads['path'], "{$base}-lean.{$ext}" );
	$path     = path_join( $uploads['path'], $filename );
	$name     = pathinfo( $filename, PATHINFO_FILENAME );
	$written  = array();

	if ( ! lean_images_move_upload( $full['tmp'], $path ) ) {
		return new WP_Error( 'lean_images_write_failed', __( 'Could not write the image to the uploads folder.', 'lean-images' ), array( 'status' => 500 ) );
	}
	$written[] = $path;

	$sizes = array();
	foreach ( $subsizes as $size_name => $sub ) {
		$sub_file = "{$name}-{$sub['width']}x{$sub['height']}.{$ext}";
		$sub_path = path_join( $uploads['path'], $sub_file );
		if ( ! lean_images_move_upload( $sub['tmp'], $sub_path ) ) {
			array_map( 'wp_delete_file', $written );
			return new WP_Error( 'lean_images_write_failed', __( 'Could not write the image to the uploads folder.', 'lean-images' ), array( 'status' => 500 ) );
		}
		$written[]           = $sub_path;
		$sizes[ $size_name ] = array(
			'file'      => $sub_file,
			'width'     => $sub['width'],
			'height'    => $sub['height'],
			'mime-type' => $sub['mime'],
			'filesize'  => wp_filesize( $sub_path ),
		);
	}

	$source        = get_post( $source_id );
	$attachment_id = wp_insert_attachment(
		array(
			'post_mime_type' => $full['mime'],
			/* translators: %s: Title of the original image. */
			'post_title'     => sprintf( __( '%s (compressed)', 'lean-images' ), $source->post_title ),
			'post_content'   => $source->post_content,
			'post_excerpt'   => $source->post_excerpt,
			'post_status'    => 'inherit',
		),
		$path,
		0,
		true
	);
	if ( is_wp_error( $attachment_id ) ) {
		array_map( 'wp_delete_file', $written );
		return $attachment_id;
	}

	$alt = get_post_meta( $source_id, '_wp_attachment_image_alt', true );
	if ( $alt ) {
		update_post_meta( $attachment_id, '_wp_attachment_image_alt', $alt );
	}

	// Sub-sizes came from the browser, so write the metadata directly instead
	// of wp_generate_attachment_metadata(), which would re-encode them.
	$source_meta = wp_get_attachment_metadata( $source_id );
	$image_meta  = isset( $source_meta['image_meta'] ) ? $source_meta['image_meta'] : array();
	if ( $image_meta ) {
		$image_meta['orientation'] = '0'; // The browser already applied EXIF rotation.
	}
	wp_update_attachment_metadata(
		$attachment_id,
		array(
			'width'      => $full['width'],
			'height'     => $full['height'],
			'file'       => _wp_relative_upload_path( $path ),
			'filesize'   => wp_filesize( $path ),
			'sizes'      => $sizes,
			'image_meta' => $image_meta,
		)
	);

	return array(
		'id'          => $attachment_id,
		'url'         => wp_get_attachment_url( $attachment_id ),
		'filesize'    => wp_filesize( $path ),
		'editUrl'     => get_edit_post_link( $attachment_id, 'raw' ),
		'compressUrl' => lean_images_page_url( $attachment_id ),
	);
}

/**
 * Overwrite the existing files in place, so every URL in existing content
 * keeps working. The previous files are backed up first.
 *
 * @param int   $attachment_id Attachment ID.
 * @param array $full          Checked full-size upload.
 * @param array $subsizes      Checked sub-size uploads keyed by size name.
 * @return array|WP_Error
 */
function lean_images_replace_files( $attachment_id, $full, $subsizes ) {
	$file = get_attached_file( $attachment_id );
	$meta = wp_get_attachment_metadata( $attachment_id );
	$mime = get_post_mime_type( $attachment_id );

	if ( $full['mime'] !== $mime ) {
		return new WP_Error( 'lean_images_format_changed', __( 'Replacing keeps the file format. Save as a new image to change it.', 'lean-images' ), array( 'status' => 400 ) );
	}
	if ( (int) $meta['width'] !== $full['width'] || (int) $meta['height'] !== $full['height'] ) {
		return new WP_Error( 'lean_images_size_changed', __( 'Replacing keeps the image dimensions.', 'lean-images' ), array( 'status' => 400 ) );
	}

	$targets = array();
	foreach ( $subsizes as $size_name => $sub ) {
		$existing = $meta['sizes'][ $size_name ];
		if ( (int) $existing['width'] !== $sub['width'] || (int) $existing['height'] !== $sub['height'] ) {
			return new WP_Error( 'lean_images_size_changed', __( 'A smaller size does not match the existing file.', 'lean-images' ), array( 'status' => 400 ) );
		}
		$targets[ $size_name ] = path_join( dirname( $file ), $existing['file'] );
	}

	$backup = lean_images_backup( $attachment_id );
	if ( is_wp_error( $backup ) ) {
		return $backup;
	}

	if ( ! lean_images_move_upload( $full['tmp'], $file ) ) {
		return new WP_Error( 'lean_images_write_failed', __( 'Could not overwrite the image. Restore the backup if it looks broken.', 'lean-images' ), array( 'status' => 500 ) );
	}
	$meta['filesize'] = wp_filesize( $file );

	foreach ( $targets as $size_name => $path ) {
		if ( ! lean_images_move_upload( $subsizes[ $size_name ]['tmp'], $path ) ) {
			wp_update_attachment_metadata( $attachment_id, $meta );
			return new WP_Error( 'lean_images_write_failed', __( 'Could not overwrite every size. Restore the backup if it looks broken.', 'lean-images' ), array( 'status' => 500 ) );
		}
		$meta['sizes'][ $size_name ]['filesize'] = wp_filesize( $path );
	}

	wp_update_attachment_metadata( $attachment_id, $meta );

	return array(
		'id'       => $attachment_id,
		'url'      => wp_get_attachment_url( $attachment_id ),
		'filesize' => $meta['filesize'],
	);
}
