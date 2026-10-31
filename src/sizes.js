/**
 * Ports of WordPress' image_resize_dimensions() and wp_constrain_dimensions(),
 * so sub-sizes made in the browser get the exact dimensions (and therefore the
 * exact file names) WordPress would have produced on the server.
 */

const fuzzyMatch = ( a, b ) => Math.abs( a - b ) <= 1;

export function constrainDimensions( width, height, maxWidth = 0, maxHeight = 0 ) {
	if ( ! maxWidth && ! maxHeight ) {
		return [ width, height ];
	}

	let widthRatio = 1;
	let heightRatio = 1;
	let didWidth = false;
	let didHeight = false;

	if ( maxWidth > 0 && width > 0 && width > maxWidth ) {
		widthRatio = maxWidth / width;
		didWidth = true;
	}
	if ( maxHeight > 0 && height > 0 && height > maxHeight ) {
		heightRatio = maxHeight / height;
		didHeight = true;
	}

	const smaller = Math.min( widthRatio, heightRatio );
	const larger = Math.max( widthRatio, heightRatio );
	const ratio =
		Math.round( width * larger ) > maxWidth || Math.round( height * larger ) > maxHeight
			? smaller
			: larger;

	let w = Math.max( 1, Math.round( width * ratio ) );
	let h = Math.max( 1, Math.round( height * ratio ) );

	if ( didWidth && w === maxWidth - 1 ) {
		w = maxWidth;
	}
	if ( didHeight && h === maxHeight - 1 ) {
		h = maxHeight;
	}
	return [ w, h ];
}

/**
 * @return {null|{srcX:number, srcY:number, srcW:number, srcH:number, dstW:number, dstH:number}}
 *         Null when WordPress would skip this size.
 */
export function imageResizeDimensions( origW, origH, destW, destH, crop = false ) {
	if ( origW <= 0 || origH <= 0 || ( destW <= 0 && destH <= 0 ) ) {
		return null;
	}

	let newW;
	let newH;
	let srcX = 0;
	let srcY = 0;
	let srcW = origW;
	let srcH = origH;

	if ( crop ) {
		const aspect = origW / origH;
		newW = Math.min( destW, origW );
		newH = Math.min( destH, origH );
		if ( ! newW ) {
			newW = Math.round( newH * aspect );
		}
		if ( ! newH ) {
			newH = Math.round( newW / aspect );
		}

		const sizeRatio = Math.max( newW / origW, newH / origH );
		srcW = Math.round( newW / sizeRatio );
		srcH = Math.round( newH / sizeRatio );

		const [ x, y ] = Array.isArray( crop ) && crop.length === 2 ? crop : [ 'center', 'center' ];
		srcX = x === 'left' ? 0 : x === 'right' ? origW - srcW : Math.floor( ( origW - srcW ) / 2 );
		srcY = y === 'top' ? 0 : y === 'bottom' ? origH - srcH : Math.floor( ( origH - srcH ) / 2 );
	} else {
		[ newW, newH ] = constrainDimensions( origW, origH, destW, destH );
	}

	if ( fuzzyMatch( newW, origW ) && fuzzyMatch( newH, origH ) ) {
		return null;
	}

	return { srcX, srcY, srcW, srcH, dstW: Math.trunc( newW ), dstH: Math.trunc( newH ) };
}
