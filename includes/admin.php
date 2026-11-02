<?php
/**
 * Admin screen and the "Compress" entry points in the Media Library.
 *
 * @package LeanImages
 */

defined( 'ABSPATH' ) || exit;

// The "Source code" downloads on a release page have no build folder, so the
// editor cannot load. Point to the zip that has it.
add_action(
	'admin_notices',
	function () {
		if ( file_exists( dirname( LEAN_IMAGES_FILE ) . '/build/main.js' ) || ! current_user_can( 'activate_plugins' ) ) {
			return;
		}
		printf(
			'<div class="notice notice-error"><p>%s <a href="%s">%s</a></p></div>',
			esc_html__( 'Lean Images is missing its built editor: this copy is the source code. Install lean-images.zip from the latest release instead.', 'lean-images' ),
			esc_url( 'https://github.com/' . LEAN_IMAGES_REPOSITORY . '/releases/latest' ),
			esc_html__( 'Latest release', 'lean-images' )
		);
	}
);

add_action(
	'admin_menu',
	function () {
		add_media_page(
			__( 'Compress image', 'lean-images' ),
			__( 'Lean Images', 'lean-images' ),
			'upload_files',
			'lean-images',
			'lean_images_render_page'
		);
	}
);

// "Compress" link in the Media Library list view.
add_filter(
	'media_row_actions',
	function ( $actions, $post ) {
		if ( lean_images_is_supported( $post->ID ) && current_user_can( 'edit_post', $post->ID ) ) {
			$actions['lean_images'] = sprintf(
				'<a href="%s">%s</a>',
				esc_url( lean_images_page_url( $post->ID ) ),
				esc_html__( 'Compress', 'lean-images' )
			);
		}
		return $actions;
	},
	10,
	2
);

// Button in the attachment details of the media modal, grid view and edit screen.
add_filter(
	'attachment_fields_to_edit',
	function ( $fields, $post ) {
		if ( lean_images_is_supported( $post->ID ) && current_user_can( 'edit_post', $post->ID ) ) {
			$fields['lean_images'] = array(
				'label' => __( 'Compress', 'lean-images' ),
				'input' => 'html',
				'html'  => sprintf(
					'<a class="button" href="%s" target="_blank">%s</a>',
					esc_url( lean_images_page_url( $post->ID ) ),
					esc_html__( 'Compress in browser', 'lean-images' )
				),
			);
		}
		return $fields;
	},
	10,
	2
);

add_action(
	'admin_enqueue_scripts',
	function ( $hook ) {
		if ( 'media_page_lean-images' !== $hook ) {
			return;
		}
		$url = plugin_dir_url( LEAN_IMAGES_FILE );
		wp_enqueue_style( 'lean-images', $url . 'assets/admin.css', array(), LEAN_IMAGES_VERSION );
		wp_enqueue_script_module( 'lean-images', $url . 'build/main.js', array(), LEAN_IMAGES_VERSION );
	}
);

/**
 * Everything the browser app needs to know about one attachment.
 *
 * @param int $attachment_id Attachment ID.
 * @return array
 */
function lean_images_app_config( $attachment_id ) {
	$file  = get_attached_file( $attachment_id );
	$meta  = wp_get_attachment_metadata( $attachment_id );
	$mime  = get_post_mime_type( $attachment_id );
	$sizes = array();
	foreach ( isset( $meta['sizes'] ) ? $meta['sizes'] : array() as $name => $size ) {
		$sizes[ $name ] = array(
			'width'  => (int) $size['width'],
			'height' => (int) $size['height'],
			'mime'   => isset( $size['mime-type'] ) ? $size['mime-type'] : $mime,
		);
	}

	/** This filter is documented in wp-admin/includes/image.php */
	$threshold = (int) apply_filters( 'big_image_size_threshold', 2560, array( (int) $meta['width'], (int) $meta['height'] ), $file, $attachment_id );

	return array(
		'id'              => $attachment_id,
		'basename'        => preg_replace( '/-scaled$/', '', pathinfo( $file, PATHINFO_FILENAME ) ),
		'pageUrl'         => lean_images_page_url( $attachment_id ),
		'source'          => array( 'url' => lean_images_source_url( $attachment_id ) ),
		'current'         => array(
			'mime'     => $mime,
			'width'    => (int) $meta['width'],
			'height'   => (int) $meta['height'],
			'filesize' => (int) ( empty( $meta['filesize'] ) ? wp_filesize( $file ) : $meta['filesize'] ),
			'sizes'    => (object) $sizes,
		),
		'registeredSizes' => (object) wp_get_registered_image_subsizes(),
		'threshold'       => $threshold,
		'formats'         => lean_images_formats(),
		'hasBackup'       => (bool) get_post_meta( $attachment_id, LEAN_IMAGES_BACKUP_META, true ),
		'rest'            => array(
			'root'  => esc_url_raw( rest_url() ),
			'nonce' => wp_create_nonce( 'wp_rest' ),
		),
	);
}

/**
 * Render Media → Lean Images.
 */
function lean_images_render_page() {
	// phpcs:disable WordPress.Security.NonceVerification.Recommended -- Read-only view parameters.
	$attachment_id = isset( $_GET['attachment'] ) ? absint( $_GET['attachment'] ) : 0;
	$done          = isset( $_GET['done'] ) ? sanitize_key( $_GET['done'] ) : '';
	// phpcs:enable

	echo '<div class="wrap">';

	if ( ! $attachment_id ) {
		printf(
			'<h1>%s</h1><p>%s</p>',
			esc_html__( 'Lean Images', 'lean-images' ),
			wp_kses_post(
				sprintf(
					/* translators: %s: Media Library URL. */
					__( 'Open an image in the <a href="%s">Media Library</a> and choose <strong>Compress</strong>. Compression runs in your browser with MozJPEG, WebP, AVIF and OxiPNG; only the result is uploaded to this site.', 'lean-images' ),
					esc_url( admin_url( 'upload.php?mode=list' ) )
				)
			)
		);
		echo '</div>';
		return;
	}

	if ( ! lean_images_is_supported( $attachment_id ) || ! current_user_can( 'edit_post', $attachment_id ) ) {
		printf( '<h1>%s</h1><p>%s</p></div>', esc_html__( 'Lean Images', 'lean-images' ), esc_html__( 'This file is not a JPEG, PNG, WebP or AVIF image you can edit.', 'lean-images' ) );
		return;
	}

	printf(
		'<h1 class="wp-heading-inline">%s</h1> <a class="page-title-action" href="%s">%s</a><hr class="wp-header-end">',
		/* translators: %s: Image title. */
		esc_html( sprintf( __( 'Compress “%s”', 'lean-images' ), get_the_title( $attachment_id ) ) ),
		esc_url( get_edit_post_link( $attachment_id ) ),
		esc_html__( 'Edit image details', 'lean-images' )
	);

	$notices = array(
		'replaced' => __( 'Image replaced. Browsers and CDNs may show the old version until their cache expires.', 'lean-images' ),
		'restored' => __( 'The original files are back.', 'lean-images' ),
	);
	if ( isset( $notices[ $done ] ) ) {
		printf( '<div class="notice notice-success is-dismissible"><p>%s</p></div>', esc_html( $notices[ $done ] ) );
	}

	printf(
		'<div id="lean-images-app" data-config="%s"></div><noscript>%s</noscript></div>',
		esc_attr( wp_json_encode( lean_images_app_config( $attachment_id ) ) ),
		esc_html__( 'Lean Images needs JavaScript.', 'lean-images' )
	);
}
