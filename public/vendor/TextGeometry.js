// Three.js r128 — TextGeometry
// Source: https://github.com/mrdoob/three.js/blob/r128/examples/js/geometries/TextGeometry.js
( function () {

	class TextGeometry extends THREE.ExtrudeGeometry {
		constructor( text, parameters = {} ) {
			const font = parameters.font;
			if ( font === undefined ) {
				super();
			} else {
				const shapes = font.generateShapes( text, parameters.size );
				const extrudeSettings = {
					depth:          parameters.height        !== undefined ? parameters.height        : 50,
					bevelThickness: parameters.bevelThickness !== undefined ? parameters.bevelThickness : 10,
					bevelSize:      parameters.bevelSize      !== undefined ? parameters.bevelSize      : 8,
					bevelEnabled:   parameters.bevelEnabled   !== undefined ? parameters.bevelEnabled   : false,
					bevelSegments:  parameters.bevelSegments  !== undefined ? parameters.bevelSegments  : 3,
					curveSegments:  parameters.curveSegments  !== undefined ? parameters.curveSegments  : 12,
				};
				super( shapes, extrudeSettings );
			}
			this.type = 'TextGeometry';
		}
	}

	THREE.TextGeometry = TextGeometry;

} )();
