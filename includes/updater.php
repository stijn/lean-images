<?php
/**
 * Updates from GitHub releases.
 *
 * The plugin header's "Update URI" points at github.com, so WordPress asks the
 * update_plugins_github.com filter instead of WordPress.org. Each release must
 * carry a lean-images.zip asset (the release workflow builds it).
 *
 * The releases API only answers for public repositories; while the repository
 * is private this finds nothing and WordPress simply reports no update.
 *
 * @package LeanImages
 */

defined( 'ABSPATH' ) || exit;

const LEAN_IMAGES_REPOSITORY = 'stijn/lean-images';

/**
 * Latest release with a plugin zip, cached for a few hours.
 *
 * @return array{version: string, package: string, url: string, notes: string}|null
 */
function lean_images_latest_release() {
	$cached = get_site_transient( 'lean_images_release' );
	if ( false !== $cached ) {
		return $cached ? $cached : null;
	}

	$response = wp_remote_get(
		'https://api.github.com/repos/' . LEAN_IMAGES_REPOSITORY . '/releases/latest',
		array(
			'timeout' => 10,
			'headers' => array( 'Accept' => 'application/vnd.github+json' ),
		)
	);

	$release = null;
	if ( 200 === wp_remote_retrieve_response_code( $response ) ) {
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		foreach ( isset( $data['assets'] ) ? $data['assets'] : array() as $asset ) {
			if ( 'lean-images.zip' === $asset['name'] ) {
				$release = array(
					'version' => ltrim( $data['tag_name'], 'v' ),
					'package' => $asset['browser_download_url'],
					'url'     => $data['html_url'],
					'notes'   => (string) $data['body'],
				);
			}
		}
	}

	// An empty string caches "nothing found" too, so a private repo or a
	// GitHub hiccup does not trigger a request on every admin page.
	set_site_transient( 'lean_images_release', $release ? $release : '', 3 * HOUR_IN_SECONDS );
	return $release;
}

add_filter(
	'update_plugins_github.com',
	function ( $update, $plugin_data, $plugin_file ) {
		if ( plugin_basename( LEAN_IMAGES_FILE ) !== $plugin_file ) {
			return $update;
		}
		$release = lean_images_latest_release();
		if ( ! $release ) {
			return $update;
		}
		return array(
			'slug'    => 'lean-images',
			'version' => $release['version'],
			'url'     => $release['url'],
			'package' => $release['package'],
		);
	},
	10,
	3
);

// "View details" in the update notice.
add_filter(
	'plugins_api',
	function ( $result, $action, $args ) {
		if ( 'plugin_information' !== $action || empty( $args->slug ) || 'lean-images' !== $args->slug ) {
			return $result;
		}
		$release = lean_images_latest_release();
		if ( ! $release ) {
			return $result;
		}
		return (object) array(
			'name'          => 'Lean Images',
			'slug'          => 'lean-images',
			'version'       => $release['version'],
			'homepage'      => 'https://github.com/' . LEAN_IMAGES_REPOSITORY,
			'download_link' => $release['package'],
			'sections'      => array( 'changelog' => wpautop( esc_html( $release['notes'] ) ) ),
		);
	},
	10,
	3
);

// "Check again" on Dashboard → Updates should really ask GitHub again.
add_action(
	'load-update-core.php',
	function () {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Only clears a cache.
		if ( isset( $_GET['force-check'] ) ) {
			delete_site_transient( 'lean_images_release' );
		}
	}
);
