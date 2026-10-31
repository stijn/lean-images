import { FORMATS, RESIZE_DEFAULTS, RESIZE_CONTROLS, METADATA_DEFAULTS, METADATA_CONTROLS } from './formats.js';
import { constrainDimensions, imageResizeDimensions } from './sizes.js';

const root = document.getElementById( 'lean-images-app' );
const config = JSON.parse( root.dataset.config );

/* ------------------------------------------------------------------ worker */

const calls = new Map();
let nextCall = 0;
let worker = null;

function startWorker() {
	worker = new Worker( new URL( './worker.js', import.meta.url ), { type: 'module' } );
	worker.onmessage = ( { data } ) => {
		const call = calls.get( data.id );
		calls.delete( data.id );
		if ( data.error ) {
			call.reject( new Error( data.error ) );
		} else {
			call.resolve( data.result );
		}
	};
	worker.onerror = ( event ) => rejectCalls( new Error( event.message || 'The codec worker crashed.' ) );
	return callWorker( { type: 'load', url: config.source.url } );
}

function rejectCalls( error ) {
	calls.forEach( ( call ) => call.reject( error ) );
	calls.clear();
}

// Encoders cannot be interrupted, so a slow encode (CIEDE2000 palettes, AVIF
// at speed 0) is cancelled by throwing the whole worker away.
const CANCELLED = 'cancelled';
function restartWorker() {
	worker.terminate();
	rejectCalls( new Error( CANCELLED ) );
	startWorker();
}

function callWorker( message ) {
	const id = ++nextCall;
	return new Promise( ( resolve, reject ) => {
		calls.set( id, { resolve, reject } );
		worker.postMessage( { ...message, id } );
	} );
}

/* ------------------------------------------------------------------- state */

// Settings are remembered per browser, so a tuned recipe is there next time.
const STORAGE_KEY = 'lean-images-settings-v1';
const formats = config.formats.filter( ( mime ) => FORMATS[ mime ] );
const freshOptions = () => Object.fromEntries( formats.map( ( mime ) => [ mime, { ...FORMATS[ mime ].defaults } ] ) );
const saved = readSettings();

const state = {
	source: null,
	format: formats.includes( config.current.mime ) ? config.current.mime : formats[ 0 ],
	options: mergeSaved( freshOptions(), saved.options ),
	resize: { ...RESIZE_DEFAULTS, ...saved.resize },
	keep: { ...METADATA_DEFAULTS, ...saved.keep },
	background: saved.background || '#ffffff',
	open: { advanced: false, resize: false, metadata: false, ...saved.open },
	width: 0,
	zoom: 'fit',
	result: null,
	busy: false,
};

function readSettings() {
	try {
		return JSON.parse( window.localStorage.getItem( STORAGE_KEY ) ) || {};
	} catch {
		return {};
	}
}

function writeSettings() {
	try {
		const { options, resize, keep, background, open } = state;
		window.localStorage.setItem( STORAGE_KEY, JSON.stringify( { options, resize, keep, background, open } ) );
	} catch {}
}

// Only keys that still exist, so a plugin update can rename or drop options.
function mergeSaved( fresh, stored = {} ) {
	for ( const [ mime, options ] of Object.entries( fresh ) ) {
		for ( const key of Object.keys( options ) ) {
			if ( stored[ mime ] && key in stored[ mime ] ) {
				options[ key ] = stored[ mime ][ key ];
			}
		}
	}
	return fresh;
}

const outputHeight = () => Math.max( 1, Math.round( ( state.source.height * state.width ) / state.source.width ) );

/* --------------------------------------------------------------------- DOM */

function h( tag, attrs = {}, ...children ) {
	const el = document.createElement( tag );
	for ( const [ key, value ] of Object.entries( attrs ) ) {
		if ( key.startsWith( 'on' ) ) {
			el.addEventListener( key.slice( 2 ), value );
		} else if ( key in el && typeof value !== 'string' ) {
			el[ key ] = value;
		} else if ( value !== false && value !== null && value !== undefined ) {
			el.setAttribute( key, value === true ? '' : value );
		}
	}
	el.append( ...children.flat().filter( ( child ) => child !== null && child !== false ) );
	return el;
}

const formatBytes = ( bytes ) =>
	bytes >= 1048576 ? `${ ( bytes / 1048576 ).toFixed( 2 ) } MB` : `${ Math.max( 1, Math.round( bytes / 1024 ) ) } KB`;

const ui = {
	before: h( 'img', { class: 'li-before', alt: '', src: config.source.url, draggable: false } ),
	after: h( 'img', {
		class: 'li-after',
		alt: '',
		draggable: false,
		onerror: () => ui.after.getAttribute( 'src' ) && setStatus( 'This browser cannot display the result. It would not show on your site either.', 'error' ),
	} ),
	compare: null,
	spinner: h( 'div', { class: 'li-spinner', hidden: true }, 'Encoding…' ),
	stats: h( 'dl', { class: 'li-stats' } ),
	controls: h( 'div', { class: 'li-controls' } ),
	width: h( 'input', { type: 'number', min: 1, step: 1, class: 'small-text', onchange: onWidthChange } ),
	height: h( 'input', { type: 'number', min: 1, step: 1, class: 'small-text', onchange: onHeightChange } ),
	status: h( 'p', { class: 'li-status', role: 'status' } ),
	saveNew: h( 'button', { type: 'button', class: 'button button-primary', onclick: () => save( 'new' ) }, 'Save as new image' ),
	replace: h( 'button', { type: 'button', class: 'button', onclick: () => save( 'replace' ) }, 'Replace this image' ),
	replaceNote: h( 'p', { class: 'description' } ),
	restore: config.hasBackup
		? h( 'button', { type: 'button', class: 'button button-link-delete', onclick: restore }, 'Restore the original files' )
		: null,
	download: h( 'a', { class: 'button', download: '' }, 'Download' ),
};

ui.compare = h(
	'div',
	{ class: 'li-compare', style: '--split: 50%', onpointerdown: startDrag },
	ui.after,
	ui.before,
	h( 'div', { class: 'li-divider' } ),
	h( 'span', { class: 'li-tag li-tag-before' }, 'Original' ),
	h( 'span', { class: 'li-tag li-tag-after' }, 'Compressed' )
);

const zoomButtons = [ [ 'fit', 'Fit' ], [ 'actual', '100%' ] ].map( ( [ value, label ] ) =>
	h( 'button', { type: 'button', class: 'button', 'data-zoom': value, onclick: () => setZoom( value ) }, label )
);

const formatSelect = h(
	'select',
	{ onchange: ( event ) => { state.format = event.target.value; renderControls(); renderActions(); schedule(); } },
	formats.map( ( mime ) => h( 'option', { value: mime }, FORMATS[ mime ].label ) )
);

root.append(
	h(
		'div',
		{ class: 'li-app' },
		h(
			'div',
			{ class: 'li-stage' },
			h( 'div', { class: 'li-toolbar' }, h( 'div', { class: 'button-group' }, zoomButtons ), ui.spinner ),
			h( 'div', { class: 'li-viewport' }, ui.compare )
		),
		h(
			'aside',
			{ class: 'li-panel' },
			h(
				'section',
				{},
				h( 'label', { class: 'li-row' }, h( 'span', {}, 'Format' ), formatSelect ),
				h( 'div', { class: 'li-row' }, h( 'span', {}, 'Size' ), h( 'span', {}, ui.width, ' × ', ui.height, ' px' ) )
			),
			ui.controls,
			h( 'button', { type: 'button', class: 'button-link li-reset', onclick: resetSettings }, 'Reset settings' ),
			ui.stats,
			h( 'section', { class: 'li-actions' }, ui.saveNew, ui.replace, ui.replaceNote, ui.download, ui.restore, ui.status )
		)
	)
);

/* ---------------------------------------------------------------- controls */

function renderControls() {
	formatSelect.value = state.format;
	const format = FORMATS[ state.format ];
	const options = state.options[ state.format ];
	const basic = format.controls.filter( ( control ) => ! control.advanced );
	const advanced = format.controls.filter( ( control ) => control.advanced );
	const metadata = state.format === 'image/jpeg' && state.source
		? METADATA_CONTROLS.filter( ( control ) => state.source.metadata[ control.key ] )
		: [];

	ui.controls.replaceChildren(
		...renderControlList( basic, options ),
		state.format === 'image/jpeg' && state.source?.hasAlpha
			? h( 'label', { class: 'li-row' },
				h( 'span', {}, 'Background for transparency' ),
				h( 'input', { type: 'color', value: state.background, onchange: ( e ) => { state.background = e.target.value; schedule(); } } )
			)
			: null,
		section( 'advanced', `More ${ format.label } settings`, renderControlList( advanced, options ) ),
		section( 'resize', 'Resizing', renderControlList( RESIZE_CONTROLS, state.resize ) ),
		metadata.length ? section( 'metadata', 'Keep metadata', renderControlList( metadata, state.keep ) ) : null
	);
}

function section( id, title, children ) {
	return h(
		'details',
		{ class: 'li-section', open: state.open[ id ], ontoggle: ( e ) => { state.open[ id ] = e.target.open; writeSettings(); } },
		h( 'summary', {}, title ),
		children
	);
}

function renderControlList( controls, values ) {
	return controls
		.filter( ( control ) => ! control.when || control.when( values ) )
		.map( ( control ) => renderControl( control, values ) );
}

function renderControl( control, values ) {
	const update = ( value ) => {
		values[ control.key ] = value;
		if ( control.type !== 'range' ) {
			renderControls(); // Dependent controls may appear or disappear.
		}
		schedule();
	};
	const tip = control.tip ? h( 'span', { class: 'li-tip', title: control.tip }, '?' ) : null;

	if ( control.type === 'checkbox' ) {
		return h( 'label', { class: 'li-row li-check' },
			h( 'input', { type: 'checkbox', checked: Boolean( values[ control.key ] ), onchange: ( e ) => update( e.target.checked ) } ),
			h( 'span', {}, control.label ), tip
		);
	}

	if ( control.type === 'select' ) {
		const el = h( 'select', { onchange: ( e ) => update( e.target.value ) },
			control.options.map( ( [ value, label ] ) => h( 'option', { value: String( value ) }, label ) )
		);
		el.value = String( values[ control.key ] );
		return h( 'label', { class: 'li-row' }, h( 'span', {}, control.label, tip ), el );
	}

	if ( control.type === 'number' ) {
		return h( 'label', { class: 'li-row' },
			h( 'span', {}, control.label, tip ),
			h( 'input', {
				type: 'number', class: 'small-text', min: control.min, max: control.max, value: String( values[ control.key ] ),
				onchange: ( e ) => update( Math.min( control.max, Math.max( control.min, Number( e.target.value ) || 0 ) ) ),
			} )
		);
	}

	const output = h( 'output', {}, String( values[ control.key ] ) );
	return h( 'label', { class: 'li-row li-range' },
		h( 'span', {}, control.label, tip ),
		h( 'input', {
			type: 'range', min: control.min, max: control.max, step: control.step, value: String( values[ control.key ] ),
			oninput: ( e ) => { output.textContent = e.target.value; update( Number( e.target.value ) ); },
		} ),
		output
	);
}

function resetSettings() {
	state.options[ state.format ] = { ...FORMATS[ state.format ].defaults };
	state.resize = { ...RESIZE_DEFAULTS };
	state.keep = { ...METADATA_DEFAULTS };
	state.background = '#ffffff';
	renderControls();
	schedule();
}

function setWidth( width ) {
	state.width = Math.min( state.source.width, Math.max( 1, Math.round( width ) || state.source.width ) );
	ui.width.value = state.width;
	ui.height.value = outputHeight();
	applyZoom();
	schedule();
}

function onWidthChange() {
	setWidth( Number( ui.width.value ) );
}

function onHeightChange() {
	setWidth( ( Number( ui.height.value ) * state.source.width ) / state.source.height );
}

function setZoom( zoom ) {
	state.zoom = zoom;
	applyZoom();
}

function applyZoom() {
	zoomButtons.forEach( ( button ) => button.classList.toggle( 'active', button.dataset.zoom === state.zoom ) );
	ui.compare.classList.toggle( 'is-actual', state.zoom === 'actual' );
	ui.compare.style.width = state.zoom === 'actual' && state.source ? `${ state.width }px` : '';
}

function startDrag( event ) {
	const rect = ui.compare.getBoundingClientRect();
	const move = ( e ) => {
		const split = Math.min( 100, Math.max( 0, ( ( e.clientX - rect.left ) / rect.width ) * 100 ) );
		ui.compare.style.setProperty( '--split', `${ split }%` );
	};
	move( event );
	ui.compare.setPointerCapture( event.pointerId );
	ui.compare.onpointermove = move;
	ui.compare.onpointerup = () => {
		ui.compare.onpointermove = null;
	};
}

/* ----------------------------------------------------------------- preview */

let timer = 0;
let running = false;
let runStarted = 0;
let rerun = false;

function schedule() {
	writeSettings();
	if ( ! state.busy ) {
		setStatus( '' ); // A "saved" message no longer describes the new settings.
		if ( running && Date.now() - runStarted > 1000 ) {
			restartWorker();
		}
	}
	clearTimeout( timer );
	timer = setTimeout( runPreview, 250 );
}

// What every encode needs besides the target dimensions.
function encodeRequest( keep = state.keep ) {
	const mime = state.format;
	return {
		type: 'encode',
		mime,
		options: FORMATS[ mime ].toEncoder( state.options[ mime ] ),
		resizeOptions: state.resize,
		background: state.background,
		keep: state.source.metadata ? Object.fromEntries( Object.entries( keep ).map( ( [ key, on ] ) => [ key, on && state.source.metadata[ key ] ] ) ) : {},
	};
}

// Only one preview encode runs at a time; changes made meanwhile collapse
// into a single follow-up run with the latest settings.
async function runPreview() {
	if ( running ) {
		rerun = true;
		return;
	}
	running = true;
	ui.spinner.hidden = false;
	do {
		rerun = false;
		runStarted = Date.now();
		const request = encodeRequest();
		try {
			const { buffer, ms } = await callWorker( { ...request, width: state.width, height: outputHeight(), crop: null } );
			showResult( new Blob( [ buffer ], { type: request.mime } ), ms );
		} catch ( error ) {
			if ( error.message === CANCELLED ) {
				rerun = true;
			} else {
				setStatus( error.message, 'error' );
			}
		}
	} while ( rerun );
	running = false;
	ui.spinner.hidden = true;
}

function showResult( blob, ms ) {
	if ( state.result ) {
		URL.revokeObjectURL( state.result.url );
	}
	state.result = { blob, ms, url: URL.createObjectURL( blob ), width: state.width, height: outputHeight() };
	ui.after.src = state.result.url;
	ui.download.href = state.result.url;
	ui.download.download = `${ config.basename }-${ state.width }w.${ FORMATS[ blob.type ].extension }`;
	renderStats();
}

function renderStats() {
	const { source, result } = state;
	const current = config.current;
	const rows = [
		[ 'Original', `${ source.width } × ${ source.height } · ${ formatBytes( source.bytes ) }` ],
		[ 'Currently served', `${ current.width } × ${ current.height } · ${ formatBytes( current.filesize ) }` ],
	];
	if ( result ) {
		const saving = Math.round( ( 1 - result.blob.size / current.filesize ) * 100 );
		rows.push( [
			'Compressed',
			h( 'strong', {}, `${ result.width } × ${ result.height } · ${ formatBytes( result.blob.size ) }` ),
			h( 'span', { class: saving >= 0 ? 'li-good' : 'li-bad' }, ` ${ saving >= 0 ? '−' : '+' }${ Math.abs( saving ) }% vs. served` ),
			h( 'span', { class: 'li-muted' }, ` · ${ ( result.ms / 1000 ).toFixed( 1 ) } s` ),
		] );
	}
	ui.stats.replaceChildren( ...rows.flatMap( ( [ label, ...value ] ) => [ h( 'dt', {}, label ), h( 'dd', {}, ...value ) ] ) );
}

/* -------------------------------------------------------------------- save */

function renderActions() {
	const sameFormat = state.format === config.current.mime;
	ui.replace.disabled = state.busy || ! sameFormat;
	ui.replaceNote.textContent = sameFormat
		? `Overwrites the ${ config.current.width } × ${ config.current.height } file and its ${ Object.keys( config.current.sizes ).length } smaller sizes with these settings. URLs stay the same; the old files are backed up.`
		: `Replacing keeps the file format (${ FORMATS[ config.current.mime ]?.label ?? config.current.mime }), so posts that use this image keep working. Pick that format, or save as a new image.`;
	ui.saveNew.disabled = state.busy;
	if ( ui.restore ) {
		ui.restore.disabled = state.busy;
	}
}

// The full image plus every registered sub-size, dimensioned like WordPress
// would. Crops are mapped back onto the original's pixels.
function newImageTargets() {
	const full = { name: 'full', width: state.width, height: outputHeight(), crop: null };
	const scale = state.source.width / full.width;
	const targets = [ full ];
	for ( const [ name, size ] of Object.entries( config.registeredSizes ) ) {
		const dims = imageResizeDimensions( full.width, full.height, size.width, size.height, size.crop );
		if ( ! dims ) {
			continue;
		}
		const crop = size.crop
			? {
				x: Math.round( dims.srcX * scale ),
				y: Math.round( dims.srcY * scale ),
				w: Math.round( dims.srcW * scale ),
				h: Math.round( dims.srcH * scale ),
			}
			: null;
		targets.push( { name, width: dims.dstW, height: dims.dstH, crop } );
	}
	return targets;
}

// Exactly the files that exist now, at their current dimensions, so every
// file name (and every URL in existing posts) stays valid.
function replaceTargets() {
	const { source } = state;
	const current = config.current;
	const targets = [ { name: 'full', width: current.width, height: current.height, crop: null } ];
	for ( const [ name, size ] of Object.entries( current.sizes ) ) {
		if ( size.mime !== current.mime ) {
			continue;
		}
		let crop = null;
		if ( Math.abs( size.width / size.height - source.width / source.height ) > 0.01 ) {
			const dims = imageResizeDimensions( source.width, source.height, size.width, size.height, true );
			crop = dims ? { x: dims.srcX, y: dims.srcY, w: dims.srcW, h: dims.srcH } : null;
		}
		targets.push( { name, width: size.width, height: size.height, crop } );
	}
	return targets;
}

async function save( mode ) {
	if ( mode === 'replace' && ! window.confirm( 'Overwrite the files of this image? The current files are backed up first and can be restored here.' ) ) {
		return;
	}

	const targets = mode === 'replace' ? replaceTargets() : newImageTargets();
	// EXIF, XMP and IPTC go into the full size only; the colour profile goes
	// everywhere because the pixels depend on it.
	const fullRequest = encodeRequest();
	const subRequest = encodeRequest( { ...METADATA_DEFAULTS, icc: state.keep.icc } );
	const extension = FORMATS[ fullRequest.mime ].extension;
	const form = new FormData();
	const names = {};
	const encoded = new Map();

	setBusy( true );
	try {
		for ( const [ index, target ] of targets.entries() ) {
			setStatus( `Encoding ${ target.name } (${ index + 1 }/${ targets.length })…` );
			const request = index === 0 ? fullRequest : subRequest;
			const key = JSON.stringify( [ index === 0, target.width, target.height, target.crop ] );
			if ( ! encoded.has( key ) ) {
				const { buffer } = await callWorker( { ...request, width: target.width, height: target.height, crop: target.crop } );
				encoded.set( key, new Blob( [ buffer ], { type: request.mime } ) );
			}
			const field = index === 0 ? 'full' : `sub_${ index }`;
			if ( index > 0 ) {
				names[ field ] = target.name;
			}
			form.append( field, encoded.get( key ), `${ field }.${ extension }` );
		}
		form.append( 'mode', mode );
		form.append( 'sizes', JSON.stringify( names ) );

		setStatus( 'Uploading…' );
		const result = await rest( 'save', form );
		if ( mode === 'replace' ) {
			window.location.assign( `${ config.pageUrl }&done=replaced` );
			return;
		}
		setStatus( '', 'success' );
		ui.status.append(
			`Saved as a new image (${ formatBytes( result.filesize ) }). `,
			h( 'a', { href: result.editUrl }, 'Edit it' ),
			' · ',
			h( 'a', { href: result.compressUrl }, 'Compress it again' )
		);
	} catch ( error ) {
		setStatus( error.message, 'error' );
	} finally {
		setBusy( false );
	}
}

async function restore() {
	if ( ! window.confirm( 'Put the files from before the first replacement back?' ) ) {
		return;
	}
	setBusy( true );
	try {
		await rest( 'restore' );
		window.location.assign( `${ config.pageUrl }&done=restored` );
	} catch ( error ) {
		setStatus( error.message, 'error' );
		setBusy( false );
	}
}

async function rest( action, body ) {
	const response = await fetch( `${ config.rest.root }lean-images/v1/attachments/${ config.id }/${ action }`, {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'X-WP-Nonce': config.rest.nonce },
		body,
	} );
	const json = await response.json().catch( () => ( {} ) );
	if ( ! response.ok ) {
		throw new Error( json.message || `The server answered with HTTP ${ response.status }.` );
	}
	return json;
}

function setBusy( busy ) {
	state.busy = busy;
	renderActions();
}

function setStatus( message, type = '' ) {
	ui.status.className = `li-status${ type ? ` is-${ type }` : '' }`;
	ui.status.textContent = message;
}

/* -------------------------------------------------------------------- boot */

renderControls();
renderActions();
applyZoom();
setStatus( 'Loading the original…' );
setBusy( true );

startWorker()
	.then( ( source ) => {
		state.source = source;
		// Start where WordPress would: big uploads get capped at the
		// big_image_size_threshold (PNGs are never scaled by core).
		const [ width ] = config.threshold && config.current.mime !== 'image/png'
			? constrainDimensions( source.width, source.height, config.threshold, config.threshold )
			: [ source.width ];
		state.width = width;
		ui.width.max = source.width;
		ui.height.max = source.height;
		ui.width.value = width;
		ui.height.value = outputHeight();
		setStatus( '' );
		setBusy( false );
		applyZoom();
		renderControls(); // Transparency and metadata options depend on the source.
		renderStats();
		runPreview();
	} )
	.catch( ( error ) => setStatus( error.message, 'error' ) );
