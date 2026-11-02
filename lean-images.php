<?php
/**
 * Plugin Name:       Lean Images
 * Description:       Compress images in your browser with MozJPEG, WebP, AVIF and OxiPNG (WebAssembly), with a live before/after preview. Nothing is sent to a third party.
 * Version:           0.3.3
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Author:            Stijn Vogels
 * Plugin URI:        https://github.com/stijn/lean-images
 * Update URI:        https://github.com/stijn/lean-images
 * License:           GPL-2.0-or-later
 * Text Domain:       lean-images
 *
 * @package LeanImages
 */

defined( 'ABSPATH' ) || exit;

// Another copy is already loaded, for example the "Source code" download from
// the same release page. Loading this one as well would declare every function
// twice, a fatal error, so this copy stays idle and says which one to delete.
if ( defined( 'LEAN_IMAGES_FILE' ) ) {
	$lean_images_folders = array( dirname( plugin_basename( LEAN_IMAGES_FILE ) ), dirname( plugin_basename( __FILE__ ) ) );
	add_action(
		'admin_notices',
		function () use ( $lean_images_folders ) {
			if ( ! current_user_can( 'activate_plugins' ) ) {
				return;
			}
			// Keep the copy that has the built editor.
			$extra = file_exists( WP_PLUGIN_DIR . '/' . $lean_images_folders[0] . '/build/main.js' ) ? $lean_images_folders[1] : $lean_images_folders[0];
			printf(
				'<div class="notice notice-error"><p>%s</p></div>',
				esc_html(
					sprintf(
						/* translators: 1, 2: plugin folders, 3: the folder to delete. */
						__( 'Lean Images is installed twice, in the plugin folders %1$s and %2$s. Deactivate and delete the copy in %3$s on the Plugins screen.', 'lean-images' ),
						$lean_images_folders[0],
						$lean_images_folders[1],
						$extra
					)
				)
			);
		}
	);
	return;
}

define( 'LEAN_IMAGES_VERSION', '0.3.3' );
define( 'LEAN_IMAGES_FILE', __FILE__ );

require __DIR__ . '/includes/files.php';
require __DIR__ . '/includes/admin.php';
require __DIR__ . '/includes/rest.php';
require __DIR__ . '/includes/updater.php';
