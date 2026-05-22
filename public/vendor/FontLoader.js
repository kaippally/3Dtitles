// Three.js r128 — FontLoader + Font
// Source: https://github.com/mrdoob/three.js/blob/r128/examples/js/loaders/FontLoader.js
( function () {

	class FontLoader extends THREE.Loader {
		constructor( manager ) { super( manager ); }
		load( url, onLoad, onProgress, onError ) {
			const scope = this;
			const loader = new THREE.FileLoader( this.manager );
			loader.setPath( this.path );
			loader.setRequestHeader( this.requestHeader );
			loader.setWithCredentials( this.withCredentials );
			loader.load( url, function ( text ) {
				const font = scope.parse( JSON.parse( text ) );
				if ( onLoad !== undefined ) onLoad( font );
			}, onProgress, onError );
		}
		parse( json ) { return new Font( json ); }
	}

	class Font {
		constructor( data ) { this.type = 'Font'; this.data = data; }
		generateShapes( text, size = 100 ) {
			const shapes = [];
			const paths = createPaths( text, size, this.data );
			for ( let p = 0, pl = paths.length; p < pl; p ++ )
				Array.prototype.push.apply( shapes, paths[ p ].toShapes() );
			return shapes;
		}
	}

	function createPaths( text, size, data ) {
		const chars = Array.from( text );
		const scale = size / data.resolution;
		const line_height = ( data.boundingBox.yMax - data.boundingBox.yMin + data.underlineThickness ) * scale;
		const paths = [];
		let offsetX = 0, offsetY = 0;
		for ( let i = 0; i < chars.length; i ++ ) {
			const char = chars[ i ];
			if ( char === '\n' ) { offsetX = 0; offsetY -= line_height; }
			else {
				const ret = createPath( char, scale, offsetX, offsetY, data );
				offsetX += ret.offsetX;
				paths.push( ret.path );
			}
		}
		return paths;
	}

	function createPath( char, scale, offsetX, offsetY, data ) {
		const glyph = data.glyphs[ char ] || data.glyphs[ '?' ];
		if ( ! glyph ) {
			console.error( 'THREE.Font: character "' + char + '" does not exist in font family ' + data.familyName );
			return { offsetX: 0, path: new THREE.ShapePath() };
		}
		const path = new THREE.ShapePath();
		let x, y, cpx, cpy, cpx1, cpy1, cpx2, cpy2;
		if ( glyph.o ) {
			const outline = glyph._cachedOutline || ( glyph._cachedOutline = glyph.o.split( ' ' ) );
			for ( let i = 0, l = outline.length; i < l; ) {
				const action = outline[ i ++ ];
				switch ( action ) {
					case 'm':
						x = outline[ i ++ ] * scale + offsetX;
						y = outline[ i ++ ] * scale + offsetY;
						path.moveTo( x, y ); break;
					case 'l':
						x = outline[ i ++ ] * scale + offsetX;
						y = outline[ i ++ ] * scale + offsetY;
						path.lineTo( x, y ); break;
					case 'q':
						cpx  = outline[ i ++ ] * scale + offsetX;
						cpy  = outline[ i ++ ] * scale + offsetY;
						cpx1 = outline[ i ++ ] * scale + offsetX;
						cpy1 = outline[ i ++ ] * scale + offsetY;
						path.quadraticCurveTo( cpx, cpy, cpx1, cpy1 ); break;
					case 'b':
						cpx  = outline[ i ++ ] * scale + offsetX;
						cpy  = outline[ i ++ ] * scale + offsetY;
						cpx1 = outline[ i ++ ] * scale + offsetX;
						cpy1 = outline[ i ++ ] * scale + offsetY;
						cpx2 = outline[ i ++ ] * scale + offsetX;
						cpy2 = outline[ i ++ ] * scale + offsetY;
						path.bezierCurveTo( cpx, cpy, cpx1, cpy1, cpx2, cpy2 ); break;
				}
			}
		}
		return { offsetX: glyph.ha * scale, path: path };
	}

	THREE.FontLoader = FontLoader;
	THREE.Font = Font;

} )();
