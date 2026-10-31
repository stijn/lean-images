/**
 * Output formats and every knob their encoders expose. `defaults` hold the UI
 * state; `toEncoder()` maps that state onto the codec's own option names.
 * Controls marked `advanced` live in a collapsible section.
 *
 * Left out on purpose: WebP's thread_level, show_compressed and
 * use_delta_palette do nothing in the single-threaded browser build, and the
 * MozJPEG build has no arithmetic coding compiled in (it aborts the encoder).
 */

const range = ( key, label, min, max, extra = {} ) => ( { type: 'range', key, label, min, max, step: 1, ...extra } );
const toggle = ( key, label, extra = {} ) => ( { type: 'checkbox', key, label, ...extra } );
const select = ( key, label, options, extra = {} ) => ( { type: 'select', key, label, options, ...extra } );
const number = ( key, label, min, max, extra = {} ) => ( { type: 'number', key, label, min, max, ...extra } );

export const FORMATS = {
	'image/jpeg': {
		label: 'JPEG (MozJPEG)',
		extension: 'jpg',
		defaults: {
			quality: 75,
			auto_subsample: true,
			chroma_subsample: 2,
			separate_chroma_quality: false,
			chroma_quality: 75,
			color_space: 3,
			progressive: true,
			optimize_coding: true,
			baseline: false,
			quant_table: 3,
			trellis_multipass: false,
			trellis_opt_zero: false,
			trellis_opt_table: false,
			trellis_loops: 1,
			smoothing: 0,
		},
		controls: [
			range( 'quality', 'Quality', 0, 100, { tip: 'With separate colour quality on, this is the brightness (luma) quality.' } ),
			toggle( 'separate_chroma_quality', 'Separate colour quality', { tip: 'Compress colour (chroma) harder or softer than brightness (luma).' } ),
			range( 'chroma_quality', 'Colour quality', 0, 100, { when: ( o ) => o.separate_chroma_quality } ),
			toggle( 'auto_subsample', 'Automatic chroma subsampling', { tip: 'MozJPEG picks 4:2:0, or 4:4:4 at quality 90 and up.' } ),
			select( 'chroma_subsample', 'Chroma subsampling', [
				[ 1, '4:4:4 (full colour resolution)' ],
				[ 2, '4:2:0 (half, the usual)' ],
				[ 3, 'One third' ],
				[ 4, 'One quarter (smallest)' ],
			], { when: ( o ) => ! o.auto_subsample, tip: 'Red text and sharp colour edges need 4:4:4.' } ),
			select( 'color_space', 'Colour space', [
				[ 3, 'YCbCr (normal)' ],
				[ 1, 'Greyscale' ],
				[ 2, 'RGB (no colour transform, large)' ],
			] ),
			toggle( 'progressive', 'Progressive', { tip: 'Loads blurry-to-sharp and is usually a few percent smaller.' } ),
			select( 'quant_table', 'Quantisation table', [
				[ 0, 'JPEG Annex K' ],
				[ 1, 'Flat' ],
				[ 2, 'MSSIM-tuned Kodak' ],
				[ 3, 'ImageMagick (MozJPEG default)' ],
				[ 4, 'PSNR-HVS-M tuned Kodak' ],
				[ 5, 'Klein, Silverstein & Carney' ],
				[ 6, 'Watson, Taylor & Borthwick' ],
				[ 7, 'Ahumada, Watson & Peterson' ],
				[ 8, 'Peterson, Ahumada & Watson' ],
			], { advanced: true } ),
			toggle( 'trellis_multipass', 'Trellis multipass', { advanced: true } ),
			toggle( 'trellis_opt_zero', 'Optimise runs of zero blocks', { advanced: true } ),
			toggle( 'trellis_opt_table', 'Optimise quantisation table after trellis', { advanced: true } ),
			range( 'trellis_loops', 'Trellis loops', 1, 50, { advanced: true } ),
			range( 'smoothing', 'Smoothing', 0, 100, { advanced: true, tip: 'Blurs noise and old JPEG artefacts before encoding.' } ),
			toggle( 'optimize_coding', 'Optimise Huffman tables', { advanced: true } ),
			toggle( 'baseline', 'Force baseline-compatible quantisation', { advanced: true, tip: 'Caps quantisation values at 255 for very old decoders.' } ),
		],
		toEncoder: ( o ) => ( {
			...o,
			chroma_subsample: Number( o.chroma_subsample ),
			color_space: Number( o.color_space ),
			quant_table: Number( o.quant_table ),
		} ),
	},

	'image/webp': {
		label: 'WebP',
		extension: 'webp',
		defaults: {
			lossless: false,
			quality: 75,
			target_size: 0,
			target_PSNR: 0,
			method: 4,
			near_lossless: 100,
			exact: false,
			alpha_quality: 100,
			alpha_compression: 1,
			alpha_filtering: 1,
			use_sharp_yuv: false,
			image_hint: 0,
			sns_strength: 50,
			filter_strength: 60,
			filter_sharpness: 0,
			filter_type: 1,
			autofilter: false,
			segments: 4,
			pass: 1,
			partitions: 0,
			partition_limit: 0,
			preprocessing: 0,
			emulate_jpeg_size: false,
			low_memory: false,
		},
		controls: [
			toggle( 'lossless', 'Lossless' ),
			range( 'quality', 'Quality', 0, 100, { tip: 'In lossless mode this is compression effort instead.' } ),
			range( 'method', 'Effort', 0, 6, { tip: 'Higher is slower but smaller.' } ),
			range( 'near_lossless', 'Near-lossless', 0, 100, { when: ( o ) => o.lossless, tip: '100 is fully lossless; lower values allow small pixel changes for smaller files.' } ),
			toggle( 'exact', 'Keep colour of transparent pixels', { when: ( o ) => o.lossless } ),
			range( 'alpha_quality', 'Transparency quality', 0, 100, { when: ( o ) => ! o.lossless } ),
			toggle( 'use_sharp_yuv', 'Sharp RGB→YUV conversion', { when: ( o ) => ! o.lossless, tip: 'Keeps colour edges crisper at a small size cost.' } ),
			number( 'target_size', 'Target size (KB, 0 = off)', 0, 100000, { when: ( o ) => ! o.lossless, tip: 'Searches for the quality that hits this size. Combine with more passes.' } ),
			range( 'target_PSNR', 'Target PSNR (dB, 0 = off)', 0, 60, { when: ( o ) => ! o.lossless } ),
			select( 'image_hint', 'Image type hint', [
				[ 0, 'Default' ],
				[ 1, 'Picture (indoor)' ],
				[ 2, 'Photo (outdoor)' ],
				[ 3, 'Graphic' ],
			], { advanced: true } ),
			range( 'sns_strength', 'Spatial noise shaping', 0, 100, { advanced: true } ),
			range( 'filter_strength', 'Deblocking filter strength', 0, 100, { advanced: true } ),
			range( 'filter_sharpness', 'Deblocking filter sharpness', 0, 7, { advanced: true } ),
			select( 'filter_type', 'Deblocking filter type', [
				[ 0, 'Simple' ],
				[ 1, 'Strong' ],
			], { advanced: true } ),
			toggle( 'autofilter', 'Auto-adjust filter strength', { advanced: true } ),
			range( 'segments', 'Segments', 1, 4, { advanced: true } ),
			range( 'pass', 'Entropy passes', 1, 10, { advanced: true } ),
			range( 'partitions', 'Token partitions (log₂)', 0, 3, { advanced: true } ),
			range( 'partition_limit', 'Partition limit', 0, 100, { advanced: true, tip: 'Trades quality for staying under the 512 kB first-partition limit on huge images.' } ),
			select( 'preprocessing', 'Preprocessing', [
				[ 0, 'None' ],
				[ 1, 'Segment smoothing' ],
				[ 2, 'Pseudo-random dithering' ],
			], { advanced: true } ),
			select( 'alpha_compression', 'Transparency compression', [
				[ 1, 'Lossless' ],
				[ 0, 'None' ],
			], { advanced: true } ),
			select( 'alpha_filtering', 'Transparency filtering', [
				[ 0, 'None' ],
				[ 1, 'Fast' ],
				[ 2, 'Best' ],
			], { advanced: true } ),
			toggle( 'emulate_jpeg_size', 'Match JPEG size at same quality', { advanced: true } ),
			toggle( 'low_memory', 'Low memory', { advanced: true } ),
		],
		// libwebp's config struct is all integers, booleans included.
		toEncoder: ( o ) => ( {
			...Object.fromEntries( Object.entries( o ).map( ( [ key, value ] ) => [ key, Number( value ) ] ) ),
			target_size: Math.round( o.target_size * 1024 ),
		} ),
	},

	'image/avif': {
		label: 'AVIF',
		extension: 'avif',
		defaults: {
			lossless: false,
			quality: 50,
			qualityAlpha: -1,
			speed: 6,
			subsample: 1,
			bitDepth: 8,
			enableSharpYUV: false,
			chromaDeltaQ: false,
			tune: 0,
			sharpness: 0,
			denoiseLevel: 0,
			tileRowsLog2: 0,
			tileColsLog2: 0,
		},
		controls: [
			toggle( 'lossless', 'Lossless' ),
			range( 'quality', 'Quality', 0, 100, { when: ( o ) => ! o.lossless } ),
			range( 'speed', 'Speed', 0, 10, { tip: 'Lower is slower but smaller. Below 4 gets very slow on large images.' } ),
			select( 'subsample', 'Chroma subsampling', [
				[ 1, '4:2:0' ],
				[ 2, '4:2:2' ],
				[ 3, '4:4:4' ],
				[ 0, '4:0:0 (greyscale)' ],
			], { when: ( o ) => ! o.lossless } ),
			range( 'qualityAlpha', 'Transparency quality (−1 = same)', -1, 100, { when: ( o ) => ! o.lossless } ),
			select( 'bitDepth', 'Bit depth', [
				[ 8, '8-bit' ],
				[ 10, '10-bit' ],
				[ 12, '12-bit' ],
			], { tip: '10-bit can reduce banding in smooth gradients.' } ),
			toggle( 'enableSharpYUV', 'Sharp RGB→YUV conversion' ),
			select( 'tune', 'Tune for', [
				[ 0, 'Auto' ],
				[ 1, 'PSNR' ],
				[ 2, 'SSIM' ],
			], { advanced: true } ),
			toggle( 'chromaDeltaQ', 'Chroma delta quantisation', { advanced: true } ),
			range( 'sharpness', 'Sharpness', 0, 7, { advanced: true } ),
			range( 'denoiseLevel', 'Denoise', 0, 50, { advanced: true } ),
			range( 'tileRowsLog2', 'Tile rows (log₂)', 0, 6, { advanced: true } ),
			range( 'tileColsLog2', 'Tile columns (log₂)', 0, 6, { advanced: true } ),
		],
		toEncoder: ( o ) => ( {
			...o,
			subsample: Number( o.subsample ),
			bitDepth: Number( o.bitDepth ),
			tune: Number( o.tune ),
		} ),
	},

	'image/png': {
		label: 'PNG (OxiPNG)',
		extension: 'png',
		defaults: {
			reduce: false,
			colors: 256,
			dither: 'floyd-steinberg',
			palette: 'wuquant',
			distance: 'euclidean-bt709',
			posterize: 8,
			level: 2,
			optimiseAlpha: true,
			interlace: false,
		},
		controls: [
			toggle( 'reduce', 'Reduce colours (lossy)', { tip: 'Converts to a palette of at most 256 colours. Often 60–80% smaller.' } ),
			range( 'colors', 'Colours', 2, 256, { when: ( o ) => o.reduce } ),
			select( 'dither', 'Dithering', [
				[ 'nearest', 'None' ],
				[ 'floyd-steinberg', 'Floyd–Steinberg' ],
				[ 'false-floyd-steinberg', 'False Floyd–Steinberg' ],
				[ 'stucki', 'Stucki' ],
				[ 'atkinson', 'Atkinson' ],
				[ 'jarvis', 'Jarvis' ],
				[ 'burkes', 'Burkes' ],
				[ 'sierra', 'Sierra' ],
				[ 'two-sierra', 'Two-row Sierra' ],
				[ 'sierra-lite', 'Sierra Lite' ],
				[ 'riemersma', 'Riemersma' ],
			], { when: ( o ) => o.reduce } ),
			range( 'posterize', 'Bits per channel', 1, 8, { tip: 'Fewer bits means fewer distinct colours and better compression, lossless after that.' } ),
			range( 'level', 'Effort', 0, 6, { tip: 'Pixels never change; higher effort only finds a smaller encoding.' } ),
			toggle( 'optimiseAlpha', 'Clean fully transparent pixels' ),
			select( 'palette', 'Palette algorithm', [
				[ 'wuquant', 'Wu (fast)' ],
				[ 'neuquant', 'NeuQuant (slow)' ],
				[ 'neuquant-float', 'NeuQuant float (slow)' ],
				[ 'rgbquant', 'RgbQuant' ],
			], { advanced: true, when: ( o ) => o.reduce } ),
			select( 'distance', 'Colour distance', [
				[ 'euclidean-bt709', 'Euclidean BT.709' ],
				[ 'euclidean-bt709-noalpha', 'Euclidean BT.709, ignore alpha' ],
				[ 'euclidean', 'Euclidean' ],
				[ 'manhattan', 'Manhattan' ],
				[ 'manhattan-bt709', 'Manhattan BT.709' ],
				[ 'manhattan-nommyde', 'Manhattan (Nommyde)' ],
				[ 'cie94-textiles', 'CIE94 textiles (slow)' ],
				[ 'cie94-graphic-arts', 'CIE94 graphic arts (slow)' ],
				[ 'ciede2000', 'CIEDE2000 (slow)' ],
				[ 'color-metric', 'CompuPhase colour metric' ],
				[ 'pngquant', 'pngquant' ],
			], { advanced: true, when: ( o ) => o.reduce } ),
			toggle( 'interlace', 'Interlaced (Adam7)', { advanced: true, tip: 'Usually makes the file bigger.' } ),
		],
		toEncoder: ( o ) => ( {
			level: o.level,
			interlace: o.interlace,
			optimiseAlpha: o.optimiseAlpha,
			posterize: o.posterize,
			quantize: o.reduce
				? { colors: o.colors, imageQuantization: o.dither, paletteQuantization: o.palette, colorDistanceFormula: o.distance }
				: null,
		} ),
	},
};

export const RESIZE_DEFAULTS = {
	method: 'lanczos3',
	premultiply: true,
	linearRGB: true,
};

export const RESIZE_CONTROLS = [
	select( 'method', 'Resampling', [
		[ 'lanczos3', 'Lanczos3 (sharp)' ],
		[ 'mitchell', 'Mitchell' ],
		[ 'catrom', 'Catmull-Rom' ],
		[ 'triangle', 'Triangle (bilinear)' ],
		[ 'magicKernel', 'Magic Kernel' ],
		[ 'magicKernelSharp2013', 'Magic Kernel Sharp 2013' ],
		[ 'magicKernelSharp2021', 'Magic Kernel Sharp 2021' ],
	] ),
	toggle( 'premultiply', 'Premultiply alpha', { when: ( o ) => ! o.method.startsWith( 'magic' ) } ),
	toggle( 'linearRGB', 'Resize in linear light', { when: ( o ) => ! o.method.startsWith( 'magic' ), tip: 'Avoids darkened edges and fine detail when shrinking.' } ),
];

export const METADATA_DEFAULTS = {
	icc: false,
	exif: false,
	xmp: false,
	iptc: false,
};

export const METADATA_CONTROLS = [
	toggle( 'icc', 'Colour profile (ICC)', { tip: 'Keeps wide-gamut colour (e.g. Display P3 from phones). Off converts to sRGB. Applies to every size.' } ),
	toggle( 'exif', 'EXIF', { tip: 'Camera, date and often GPS location. Full size only.' } ),
	toggle( 'xmp', 'XMP', { tip: 'Edit history, ratings and keywords. Full size only.' } ),
	toggle( 'iptc', 'IPTC', { tip: 'Caption, author and copyright. Full size only.' } ),
];
