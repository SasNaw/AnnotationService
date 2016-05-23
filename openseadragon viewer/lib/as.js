var viewer;

function initViewer() {
	viewer = OpenSeadragon({
		id: "openseadragon1",
		prefixUrl: "lib/osd/openseadragon-bin-2.1.0/images/",
		tileSources: "dzi/test.dzi",
		showReferenceStrip: false
	});
		
	// add the scalebar
	viewer.scalebar({
		type: OpenSeadragon.ScalebarType.MICROSCOPE,
		minWidth:'150px',
		/* todo: get pixel per meter */
		pixelsPerMeter:1,
		color:'black',
		fontColor:'black',
		backgroundColor:"rgba(255,255,255,0.5)",
		barThickness:4,
		location: OpenSeadragon.ScalebarLocation.TOP_RIGHT,
		xOffset:5,
		yOffset:5
	});
}



this.initViewer();
