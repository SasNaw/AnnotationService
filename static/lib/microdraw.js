//(function() {                 // force everything local.
var debug = 1;

var ImageInfo = {};             // regions, and projectID (for the paper.js canvas) for each slices, can be accessed by
                                // the slice name. (e.g. ImageInfo[imageOrder[viewer.current_page()]])
                                // regions contain a paper.js path, a unique ID and a name
var imageOrder = [];            // names of slices ordered by their openseadragon page numbers
var currentImage = undefined;   // name of the current image
var prevImage = undefined;      // name of the last image
var region = null;	            // currently selected region (one element of Regions[])
var copyRegion;		            // clone of the currently selected region for copy/paste
var handle;			            // currently selected control point or handle (if any)
var selectedTool;	            // currently selected tool
var viewer;			            // open seadragon viewer
var navEnabled = true;          // flag indicating whether the navigator is enabled (if it's not, the annotation tools are)
var magicV = 1000;	            // resolution of the annotation canvas - is changed automatically to reflect the size of the tileSource
var myOrigin = {};	            // Origin identification for DB storage
var	params;			            // URL parameters
var UndoStack = [];
var RedoStack = [];
var mouseUndo;                  // tentative undo information.
var newRegionFlag;	            // true when a region is being drawn
var drawingPolygonFlag = false; // true when drawing a polygon
var annotationLoadingFlag;      // true when an annotation is being loaded
var config = {}                 // App configuration object
var isMac = navigator.platform.match(/Mac/i)?true:false;
var isIOS = navigator.platform.match(/(iPhone|iPod|iPad)/i)?true:false;

/***
	AnnotationService variables
*/
var tmpTool;
var ruler;
var staticPath;                 // path to flasks static folder
var slide;                      // slide object with (file-)name, url and mpp
var labelDictionary = [];       // dictionary with labels
var dictionaries = [];          // list of dictionaries
var currentLabel = {label:"no label"};  // currently selected label
var countAll = 0;
var countLabel = {};

/***0
    Label handling functions
*/
function newLabel() {
    var uid = uniqueID();
    var label = prompt("Enter new region name", "new label " + uid);
    if(label !== null) {
        label = label.length == 0 ? "untitled" + uid : label;
        var color = regionHashColor(label);
        var entry = { "label":label, "uid":uid, "color":color, "alpha":config.defaultFillAlpha };
        labelDictionary.push(entry)
        saveDictionary()

        return entry;
    }
}

function appendLabelToList(label) {
    var str = [ "<div class='region-tag' id='" + label.uid + "'>",
        "<img class='eye' title='Region visible' id='eye_" + label.uid + "' src='" + staticPath + "/img/eyeOpened.svg' />",
        "<div class='region-color' id='color_" + label.uid + "'",
        "style='background-color:rgba(",
        parseInt(label.color.red),",",parseInt(label.color.green),",",parseInt(label.color.blue),",",label.alpha,
        ")'></div>",
        "<span class='region-name' id='name_" + label.uid + "' style='overflow:hidden'>" + label.label +
        '</span> (<span id="count_' + label.uid + '">0</span>)<br/>',
    ].join(" ");

    var el = $(str);
    $("#regionList").append(el);

    // handle single click on computers
    el.click(singleClickOnLabel);
    // handle double click on computers
    // el.dblclick(doublePressOnRegion);

    // select latest label
    var tags = $("#regionList > .region-tag");
    selectLabel(tags[tags.length - 1]);

    // create count entry
    countLabel[label.uid] = 0;
}

function appendLabelsToList() {
    var tags = $("#regionList > .region-tag");
    tags.each(function(i){
        tags[i].remove();
    });
    if(labelDictionary) {
        for(var i=0; i<labelDictionary.length; i++) {
            appendLabelToList(labelDictionary[i]);
        }
        // select first label automatically
        selectNextLabel();
    }
}

function selectNextLabel() {
    var index = 0;
    var labelTags = $("#regionList > .region-tag");
    if(currentLabel.uid) {
        for(var i=0; i<labelTags.length; i++) {
            if(labelTags[i].id == currentLabel.uid && i+1 < labelTags.length) {
                index = i + 1;
                break;
            }
        }
    }
    selectLabel(labelTags[index]);
}

function selectLabel(el) {
    for(var i=0; i<labelDictionary.length; i++) {
        if(el.id == labelDictionary[i].uid) {
            currentLabel = labelDictionary[i];
            $("#regionList > .region-tag").each(function(i){
                $(this).addClass("deselected");
                $(this).removeClass("selected");
            });
            var tag = $("#regionList > .region-tag#" + currentLabel.uid);
            $(tag).removeClass("deselected");
            $(tag).addClass("selected");
            break;
        }
    }
}

/***1
    Region handling functions
*/
function newPoi(point, name, pathInfo) {
    var path = new paper.Path();
    var x = point.x;
    var y = point.y;
    if(pathInfo) {
        path.strokeWidth = pathInfo.strokeWidth ? pathInfo.strokeWidth : config.defaultStrokeWidth;
        path.strokeColor = pathInfo.strokeColor ? pathInfo.strokeColor : config.defaultStrokeColor;
        path.strokeScaling = pathInfo.strokeScaling;
        path.fillColor = pathInfo.fillColor;
    } else {
        var color = regionHashColor(name);

        path.strokeWidth = config.defaultStrokeWidth;
        path.strokeColor = config.defaultStrokeColor;
        path.strokeScaling = false;
        path.fillColor = 'rgba('+color.red+','+color.green+','+color.blue+','+0.2+')';
    }
    path.selected = false;

    // path.add(new paper.Point(x, y));
    // path.add(new paper.Point(x-1, y-3));
    // path.add(new paper.Point(x, y-2));
    // path.add(new paper.Point(x+1, y-3));
    path.add(new paper.Point(x-0.1, y-0.1));
    path.add(new paper.Point(x-0.1, y+0.1));
    path.add(new paper.Point(x+0.1, y+0.1));
    path.add(new paper.Point(x+0.1, y-0.1));
    path.closed = true;

    return path;
}

function newRegion(arg, imageNumber) {
	if( debug ) console.log("> newRegion");
    var reg = {};
    if(arg.uid) {
        reg.uid = arg.uid;
    } else {
        reg.uid = currentLabel.uid;
    }

	if(arg.x && arg.y || arg.point) {
		// point of interest
		if( arg.name ) {
			reg.name = arg.name;
		} else {
			reg.name = "poi " + reg.uid;
		}
        if(arg.point) {
            reg.point = arg.point;
        } else {
	    	reg.point = arg;
        }
        reg.path = newPoi(reg.point, reg.name, arg.path);
	}
	else {
		// regular region
		if( arg.name ) {
			reg.name = arg.name;
		}
		else {
			reg.name = currentLabel.label;
		}
		var color = currentLabel.color ? currentLabel.color : regionHashColor(reg.name);
		if( arg.path ) {
			reg.path = arg.path;
		    reg.path.strokeWidth = arg.path.strokeWidth ? arg.path.strokeWidth : config.defaultStrokeWidth;
		    reg.path.strokeColor = arg.path.strokeColor ? arg.path.strokeColor : config.defaultStrokeColor;
			reg.path.strokeScaling = false;
			reg.path.fillColor = arg.path.fillColor ? arg.path.fillColor :'rgba('+color.red+','+color.green+','+color.blue+','+config.defaultFillAlpha+')';
			reg.path.selected = false;
		}
	}

    reg.context = arg.context ? arg.context : [];

	if( imageNumber === undefined ) {
		imageNumber = currentImage;
	}

	// push the new region to the Regions array
	ImageInfo[imageNumber]["Regions"].push(reg);
    // increase region count
    countAll++;
    countLabel[reg.uid] += 1;
    $('#count_all').html(countAll);
    $('#count_'+reg.uid).html(countLabel[reg.uid]);
    return reg;
}

function findContextRegion(region1) {
    for(var i=0; i<ImageInfo[0].Regions.length; i++) {
        var region2 = ImageInfo[0].Regions[i];
        if(region1.uid != region2.uid) {
            // find intersections
            var intersections = region1.path.getIntersections(region2.path);
            var isContextRegion = intersections.length > 0;

            if(!isContextRegion) {
                // check if region is drawn inside another region
                if(region2.path.contains(region1.path.segments[0].point) ||
                    region1.path.contains(region2.path.segments[0].point)) {
                    isContextRegion = true;
                }
            }

            if(isContextRegion) {
                if(!isRegionAlreadyReferenced(region1, region2)) {
                    region1.context.push(region2.uid);
                }
                if(!isRegionAlreadyReferenced(region2, region1)) {
                    region2.context.push(region1.uid);
                }
            }
        }
    }
    updateRegionList();
    selectRegion(region1);
}

function isRegionAlreadyReferenced(region1, region2) {
    var region2Name = findRegionByUID(region2.uid);
    for(var i=0; i<region1.context.length; i++) {
        var region1Name = findRegionByUID(region1.context[i]);
        if(region1Name == region2Name) {
            return true;
        }
    }
    return false;
}

function removeRegion(reg, imageNumber) {
	if( debug ) console.log("> removeRegion");

	if( imageNumber === undefined ) {
		imageNumber = currentImage;
	}

	// remove from Regions array
	ImageInfo[imageNumber]["Regions"].splice(ImageInfo[imageNumber]["Regions"].indexOf(reg),1);
	if(reg.path) {
		// remove from paths
		reg.path.remove();
	}

    // remove context reference
    for(var i=0; i<ImageInfo[0].Regions.length; i++) {
        var context = ImageInfo[0].Regions[i].context;
        for(var j=0; j<context.length; j++) {
            if(context[j] == reg.uid) {
                context.splice(j, 1);
            }
        }
    }
    // lower region count
    countAll--;
    // updateRegionList();
    countLabel[reg.uid] -= 1;
    $('#count_'+reg.uid).html(countLabel[reg.uid]);
    $('#count_all').html(countAll);
}

function selectRegion(reg) {
    if( debug ) console.log("> selectRegion");

    var i;

    for( i = 0; i < ImageInfo[currentImage]["Regions"].length; i++ ) {
		if(ImageInfo[currentImage]["Regions"][i] == reg ) {
			// Select region
			region = reg;
			if(ImageInfo[currentImage]["Regions"][i].path) {
				// Select path
				reg.path.selected = true;
			    reg.path.fullySelected = true;
			}
	    } else {
			if(ImageInfo[currentImage]["Regions"][i].path) {
				// Deselect path
				ImageInfo[currentImage]["Regions"][i].path.selected = false;
				ImageInfo[currentImage]["Regions"][i].path.fullySelected = false;
			}
	    }
    }
    paper.view.draw();
}

function deselectRegion(reg) {
    if(reg) {
        if(region.uid == reg.uid) {
            region = null;
        }
        for( var i = 0; i < ImageInfo[currentImage]["Regions"].length; i++ ) {
            if (ImageInfo[currentImage]["Regions"][i] == reg) {
                // Deselect path
                ImageInfo[currentImage]["Regions"][i].path.selected = false;
                ImageInfo[currentImage]["Regions"][i].path.fullySelected = false;
                paper.view.draw();
            }
        }
    }
}

function findRegionByUID(uid) {
    if( debug ) console.log("> findRegionByUID");

    var i;
    if( debug > 2 ) console.log( "look for uid: " + uid);
    // if( debug > 2 ) console.log( ImageInfo );
    if( debug > 2 ) console.log( "region array lenght: " + ImageInfo[currentImage]["Regions"].length );

    for( i = 0; i < ImageInfo[currentImage]["Regions"].length; i++ ) {

        if( ImageInfo[currentImage]["Regions"][i].uid == uid ) {
            if( debug > 2 ) console.log( "region " + ImageInfo[currentImage]["Regions"][i].uid + ": " );
            if( debug > 2 ) console.log( ImageInfo[currentImage]["Regions"][i] );
            return ImageInfo[currentImage]["Regions"][i];
        }
    }
    console.log("Region with unique ID "+uid+" not found");
    return null;
}

function findRegionByName(name) {
    if( debug ) console.log("> findRegionByName");
    var i;
    for( i = 0; i < ImageInfo[currentImage]["Regions"].length; i++ ) {
        if( ImageInfo[currentImage]["Regions"][i].name == name ) {
            return ImageInfo[currentImage]["Regions"][i];
        }
    }
    console.log("Region with name " + name + " not found");
    return null;
}

function uniqueID() {
    if(labelDictionary) {
        if( debug ) console.log("> uniqueID");
        return labelDictionary.length > 0 ? parseInt(labelDictionary[labelDictionary.length-1].uid) + 1 : 1;
    }
    return 0;
}

function hash(str) {
    var result = str.split("").reduce(function(a,b) {
        a = ((a<<5)-a) + b.charCodeAt(0);
        return a&a;
    },0);
    return result;
}

function regionHashColor(name) {
    //if(debug) console.log("> regionHashColor");

    var color = {};
    var h = hash(name);

    // add some randomness
    h = Math.sin(h++)*10000;
    h = 0xffffff*(h-Math.floor(h));

    color.red = h&0xff;
    color.green = (h&0xff00)>>8;
    color.blue = (h&0xff0000)>>16;
    return color;
}

function regionPicker(parent) {
    if( debug ) console.log("> regionPicker");

    $("div#regionPicker").appendTo("body");
    $("div#regionPicker").show();
}

function changeRegionName(reg,name) {
    if( debug ) console.log("> changeRegionName");

    var color = regionHashColor(name);

	if(reg.path) {
		// Update path
		reg.name = name;
		reg.path.fillColor = 'rgba('+color.red+','+color.green+','+color.blue+',0.5)';
		paper.view.draw();
	}

    // Update region tag
    $(".region-tag#" + reg.uid + ">.region-name").text(name);
    $(".region-tag#" + reg.uid + ">.region-color").css('background-color','rgba('+color.red+','+color.green+','+color.blue+',0.67)');
    updateRegionList();
}

/*** toggle visibility of region
***/
function toggleAllRegions() {
    var toggleEye = $('#toggle-poi');
    if(toggleEye[0].src.indexOf("eyeOpened.svg") === -1) {
        toggleEye.attr('src', staticPath +'/img/eyeOpened.svg');
    } else {
        toggleEye.attr('src', staticPath + '/img/eyeClosed.svg');
    }
    for(var i=0; i<labelDictionary.length; i++) {
        var eye = $('#eye_' + labelDictionary[i].uid);
        if(eye[0].src != toggleEye[0].src)
        toggleRegions(labelDictionary[i].uid);
    }
}

function toggleRegions(uid) {
    if( debug ) console.log("< toggle region");
    var regions = ImageInfo[0].Regions;
    for(var i=0; i<regions.length; i++) {
        var reg = regions[i];
        if(reg.uid == uid) {
            if( reg.path.fillColor !== null ) {
                reg.path.storeColor = reg.path.fillColor;
                reg.path.fillColor = null;

                reg.path.storeWidth = reg.path.strokeWidth;
                reg.path.strokeWidth = 0;
                reg.path.fullySelected = false;
            } else {
                reg.path.fillColor = reg.path.storeColor;
                reg.path.strokeWidth = reg.path.storeWidth;
            }
        }
    }
    paper.view.draw();
    var eye = $('#eye_' + uid);
    if(eye[0].src.indexOf("eyeOpened.svg") === -1) {
        eye.attr('src', staticPath +'/img/eyeOpened.svg');
    } else {
        eye.attr('src', staticPath + '/img/eyeClosed.svg');
        if(region) {
            if(region.uid == uid) {
                deselectRegion(region);
            }
        }
    }
    if( debug ) console.log("> toggle region");
}

function changeRegionAnnotationStyle(uid) {
    if( debug ) console.log("< changeRegionAnnotationStyle");
    for(var i=0; i<labelDictionary.length;i++) {
        if(labelDictionary[i].uid == uid) {
            annotationStyle(labelDictionary[i]);
            break;
        }
    }
    if( debug ) console.log("> changeRegionAnnotationStyle");
}

function updateRegionList() {
    // if( debug ) console.log("> updateRegionList");
    //
    // // remove all entries in the regionList
    // $("#regionList > .region-tag").each(function() {
    //     $(this).remove();
    // });
    //
    // // adding entries corresponding to the currentImage
    // for( var i = 0; i < ImageInfo[currentImage]["Regions"].length; i++ ) {
    //     var reg = ImageInfo[currentImage]["Regions"][i];
    //     // append region tag to regionList
    //     var el = $(regionTag(reg.name,reg.uid, reg.context));
    //     $("#regionList").append(el);
    //
    //     // handle single click on computers
    //     el.click(singlePressOnRegion);
    //     // handle double click on computers
    //     el.dblclick(doublePressOnRegion);
    //     // handle single and double tap on touch devices
    //     el.on("touchstart",handleRegionTap);
    // }
}

function checkRegionSize(reg) {
    // if( reg.path.length > 3 ) {
    //     return;
    // }
    // else {
    //     removeRegion(region, currentImage);
    // }
}


/***2
    Interaction: mouse and tap
*/
function convertPathToImgCoordinates(point) {
    // convert to screen coordinates
    var screenCoords = paper.view.projectToView(point);
    // convert to viewport coordinates
    var viewportCoords = viewer.viewport.pointFromPixel(new OpenSeadragon.Point(screenCoords.x, screenCoords.y));
    // convert to image coordinates
    var imgCoords = viewer.viewport.viewportToImageCoordinates(viewportCoords);
    return imgCoords;
}

function convertImgToPathCoordinates(point) {
    // convert to viewport coordinates
    var viewportCoords = viewer.viewport.imageToViewportCoordinates(point);
    // convert to screen coordinates
    var pixel = viewer.viewport.pixelFromPoint(viewportCoords);
    // convert to project coordinates
    var projectCoords = paper.view.viewToProject(pixel);
    return projectCoords;
}

function clickHandler(event){
    if( debug ) {
    	console.log("> clickHandler");
    	var webPoint = event.position;
		var viewportPoint = viewer.viewport.pointFromPixel(webPoint);
    }
    event.stopHandlers = !navEnabled;
    if( selectedTool == "draw") {
        checkRegionSize(region);
    }
    else if( selectedTool == "addpoi") {
		addPoi(event);
	}
}

function addPoi(event) {
	var webPoint = event.position;
    var point = paper.view.viewToProject(new paper.Point(webPoint.x,webPoint.y));
    var viewportPoint = viewer.viewport.pointFromPixel(webPoint);
    var imgCoord = viewer.viewport.viewportToImageCoordinates(viewportPoint);

    var source = params.source.replace(".dzi", "_files/") + viewer.source.maxLevel + "/" +
        Math.floor(imgCoord.x / 256) + "_" + Math.floor(imgCoord.y / 256) + ".jpeg";
    source = source.substr(1, source.length-1);

    //call python script
    $.ajax({
        type : "POST",
        url : "runPython.php",
        data : {script:config.segmentationScript, source:source, x:imgCoord.x, y:imgCoord.y}
    }).done(function( o ) {
        // do something
        console.log("opencv: success!");
        clearToolSelection();
    });

	var reg = newRegion(point);
    findContextRegion(reg);
    paper.view.draw();
}

function pressHandler(event){
    if( debug ) console.log("> pressHandler");

    var dictListContent = $('#dicts_content');
    if(dictListContent.is(":visible")) {
        dictListContent.hide()
    }

    if( !navEnabled ) {
        event.stopHandlers = true;
        mouseDown(event.originalEvent.layerX,event.originalEvent.layerY);
    }
}

function dragHandler(event){
    if( debug > 1 )
        console.log("> dragHandler");

    if( !navEnabled ) {
        event.stopHandlers = true;
        mouseDrag(event.originalEvent.layerX,event.originalEvent.layerY,event.delta.x,event.delta.y);
    }
}

function dragEndHandler(event){
    if( debug ) console.log("> dragEndHandler");

    if( !navEnabled ) {
        event.stopHandlers = true;
        mouseUp();
    }
}

var contextFlag = false;

function singleClickOnLabel(event) {
    if( debug ) console.log("> labelClick");
    event.stopPropagation();
    event.preventDefault();
    var clickedId = event.toElement.id;
    var el = $(this);

    if(clickedId === "eye_" + el[0].id) {
        // toogle visibility
        toggleRegions(el[0].id);
    } else if(clickedId === "color_" + el[0].id) {
        changeRegionAnnotationStyle(el[0].id);
    } else {
        selectLabel(el[0]);
    }

    if( debug ) console.log("< labelClick");
}

function singlePressOnRegion(event) {
    if( debug ) console.log("> singlePressOnRegion");
    if( debug ) console.log(event);

    event.stopPropagation();
    event.preventDefault();

    var el = $(this);
    var uid;
    var reg;
    var clickedId = event.toElement.id;

    if(el.hasClass("ontology")) {
        uid = $(".region-tag.selected").attr('id');
        reg = findRegionByUID(uid);
        var newName = el.find(".region-name").text();
        if(contextFlag) {
            reg.context.push(newName);
            contextFlag = false;
            updateRegionList();
            selectRegion(reg);
        } else {
            changeRegionName(reg, newName);
        }
        $("div#regionPicker").appendTo($("body")).hide();
    } else {
        uid = $(this).attr('id');

        if(clickedId === "eye_" + uid) {
            // toogle visibility
            toggleRegions(findRegionByUID(this.id));
        } else if(clickedId === "name_" + uid) {
            // Click on regionList (list or annotated regions)
            reg = findRegionByUID(uid);
            if( reg ) {
                selectRegion(reg);
            } else {
                console.log("region undefined");
            }
        } else if(clickedId === "color_" + uid) {
            // open color picker
            var reg = findRegionByUID(this.id);
            if( reg.path.fillColor != null ) {
                if( reg ) {
                    selectRegion(reg);
                }
                annotationStyle(reg);
            }
        } else if(clickedId === "addContext_" + uid) {
            var reg = findRegionByUID(this.id);
            if( reg ) {
                selectRegion(reg);
                if( config.drawingEnabled ) {
                    if( config.regionOntology == true ) {
                        contextFlag = true;
                        regionPicker(this);
                    }
                    else {
                        var name = prompt("Region name", findRegionByUID(this.id).name);
                        if( name != null ) {
                            changeRegionName(findRegionByUID(this.id), name);
                        }
                    }
                }
            }
        } else if(clickedId.indexOf("removeContext_" + uid) >= 0) {
            var reg = findRegionByUID(this.id);
            if( reg ) {
                selectRegion(reg);
                var index = clickedId.split("/")[1];
                reg.context.splice(index, 1);
                updateRegionList();
                selectRegion(reg);
            }
        } else {
            // Click on regionList (list or annotated regions)
            reg = findRegionByUID(uid);
            if( reg ) {
                selectRegion(reg);
            } else {
                console.log("region undefined");
            }
        }
    }
}

function doublePressOnRegion(event) {
    if( debug ) console.log("> doublePressOnRegion");

    event.stopPropagation();
    event.preventDefault();

    if( event.clientX > 20 ) {
        if( config.drawingEnabled ) {
            if( config.regionOntology == true ) {
                regionPicker(this);
            }
            else {
                var name = prompt("Region name", findRegionByUID(this.id).name);
                if( name != null ) {
                    changeRegionName(findRegionByUID(this.id), name);
                }
            }
        }
    }
    else {
        var reg = findRegionByUID(this.id);
        toggleRegions(reg);
    }
}

var tap = false
function handleRegionTap(event) {
/*
    Handles single and double tap in touch devices
*/
    if( debug ) console.log("> handleRegionTap");

    var caller = this;

    if( !tap ){ //if tap is not set, set up single tap
        tap = setTimeout(function() {
            tap = null
        },300);

        // call singlePressOnRegion(event) using 'this' as context
        singlePressOnRegion.call(this,event);
    } else {
        clearTimeout(tap);
        tap = null;

        // call doublePressOnRegion(event) using 'this' as context
        doublePressOnRegion.call(this,event);
    }
    if( debug ) console.log("< handleRegionTap");
}

function mouseDown(x,y) {
    if( debug > 1 ) console.log("> mouseDown");

    mouseUndo = getUndo();
    var prevRegion = null;
    var point = paper.view.viewToProject(new paper.Point(x,y));

    handle = null;

    if(selectedTool == "select" || selectedTool == "area") {
        var hitResult = paper.project.hitTest(point, {
            tolerance: 0,
            stroke: true,
            segments: true,
            fill: true,
            handles: true
        });

        newRegionFlag = false;
        if( hitResult ) {
            var i;
            for( i = 0; i < ImageInfo[currentImage]["Regions"].length; i++ ) {
                if( ImageInfo[currentImage]["Regions"][i].path == hitResult.item ) {
                    re = ImageInfo[currentImage]["Regions"][i];
                    break;
                }
            }

            // select path
            if( region && region != re ) {
                if(region.path) {
                    region.path.selected = false;
                }
                prevRegion = region;
            }
            selectRegion(re);

            if( hitResult.type == 'handle-in' ) {
                handle = hitResult.segment.handleIn;
                handle.point = point;
            }
            else if( hitResult.type == 'handle-out' ) {
                handle = hitResult.segment.handleOut;
                handle.point = point;
            }
            else if( hitResult.type == 'segment' ) {
                handle = hitResult.segment.point;
                handle.point = point;
            }
            if(selectedTool == "area") {
                var mpp = (mpp_x * mpp_y) / objPower;
                var area =  Math.round(((region.path.area * mpp) * 1000) * 100) / 100;
                area = area < 0 ? area * (-1) : area;
                var cpos = { top: y + 15, left: x + 15 };
                $("body").append("<div id='area-tooltip' style='position:fixed; font-size:30px;" +
                    " color:rgba(255,255,255,1); background-color:rgba(0,0,0,0.5)'></div>");
                $('#area-tooltip').offset(cpos);
                $("#area-tooltip").html(area + " μm");
            }
        }
        if( hitResult == null && region ) {
            //deselect paths
            if(region.path) {
                region.path.selected = false;
            }
            region = null;
        }
    } else if(selectedTool == "draw") {
        // Start a new region
        // if there was an older region selected, unselect it
        if(region && region.path ) {
            region.path.selected = false;
        }
        // start a new region
        var path = new paper.Path({segments:[point]})
        path.strokeWidth = config.defaultStrokeWidth;
        region = newRegion({path:path});
        // signal that a new region has been created for drawing
        newRegionFlag = true;

        commitMouseUndo();
    } else if(selectedTool == "draw-polygon") {
        // is already drawing a polygon or not?
        if( drawingPolygonFlag == false ) {
            // deselect previously selected region
            if(region && region.path ) {
                region.path.selected = false;
            }

            // Start a new Region with alpha 0
            var path = new paper.Path({segments:[point]})
            path.strokeWidth = config.defaultStrokeWidth;
            region = newRegion({path:path});
            region.path.fillColor.alpha = 0;
            region.path.selected = true;
            drawingPolygonFlag = true;
            commitMouseUndo();
        } else {
            var hitResult = paper.project.hitTest(point, {tolerance:10, segments:true});
            if( hitResult && hitResult.item == region.path && hitResult.segment.point == region.path.segments[0].point ) {
                // clicked on first point of current path
                // --> close path and remove drawing flag
                findContextRegion(region);
                finishDrawingPolygon(true);
            } else {
                // add point to region
                region.path.add(point);
                commitMouseUndo();
            }
        }
    } else if(selectedTool == "distance") {
        if(ruler) {
            ruler.remove();
        }
        ruler = new paper.Path({segments:[point]});
        var zoom = Math.sqrt(viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom(true)));
        console.log("debug: zoom = " + zoom, ", iz = " + viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom(true)));

        ruler.strokeWidth = zoom < 0.9 ? 1 - zoom : 0.1;
        ruler.strokeColor = config.defaultStrokeColor;
        ruler.strokeColor.alpha = 0.5;
        ruler.selected = true;
    }

    paper.view.draw();
}

function mouseDrag(x,y,dx,dy) {
    if( debug ) console.log("> mouseDrag");

    // transform screen coordinate into world coordinate
    var point = paper.view.viewToProject(new paper.Point(x,y));

    // transform screen delta into world delta
    var orig = paper.view.viewToProject(new paper.Point(0,0));
    var dpoint = paper.view.viewToProject(new paper.Point(dx,dy));
    dpoint.x -= orig.x;
    dpoint.y -= orig.y;

    if( handle ) {
        handle.x += point.x-handle.point.x;
        handle.y += point.y-handle.point.y;
        handle.point = point;
        commitMouseUndo();
    } else if( selectedTool == "draw") {
        region.path.add(point);
    } else if( selectedTool == "select") {
        // event.stopHandlers = true;
        for( var i in ImageInfo[currentImage]["Regions"] ) {
            var reg = ImageInfo[currentImage]["Regions"][i];
            if(reg.path) {
                if( reg.path.selected ) {
                    reg.path.position.x += dpoint.x;
                    reg.path.position.y += dpoint.y;
                }
            }
        }
    }
    if(selectedTool == "distance") {
        if(ruler) {
            if(ruler.segments[1]) {
                ruler.removeSegment(1);
            }
            ruler.add(point);

            var cpos = { top: y + 15, left: x + 15 };
            $("body").append("<div id='distance-tooltip' style='position:fixed; font-size:30px;" +
                " color:rgba(255,255,255,1); background-color:rgba(0,0,0,0.5)'></div>");
            $('#distance-tooltip').offset(cpos);
            $("#distance-tooltip").html(getDistance() + " μm");
        }
    }

    paper.view.draw();
}

function getDistance() {
    // get project coordinates of ruler segments
    var point1 = convertPathToImgCoordinates(ruler.segments[0].point);
    var point2 = convertPathToImgCoordinates(ruler.segments[1].point);

    var pxDistance = Math.sqrt(Math.pow(point2.x - point1.x, 2) + Math.pow(point2.y - point1.y, 2));
    return Math.round((pxDistance * slide.mpp) * 100) / 100;
}

function mouseUp() {
    if( debug ) console.log("> mouseUp");

    var element = document.getElementById("distance-tooltip");
    if(element) {
        element.parentNode.removeChild(element);
    }

    if( newRegionFlag == true ) {
    	if(region.path) {
    		region.path.closed = true;
		    // to delete all unnecessary segments while preserving the form of the region to make it modifiable; & adding handles to the segments
		    var orig_segments = region.path.segments.length;

            var tmpPath = region.path;

            var path = new paper.Path();
            path.selected = false;
            path.fullySelected = false;
            for(var i=0; i<region.path.segments.length; i++) {
                path.add(convertPathToImgCoordinates(region.path.segments[i].point))
            }
            path.remove();
            path.simplify(0);

            var simplePath = new paper.Path();
            for(var i=0; i<path.segments.length; i++) {
                simplePath.add(convertImgToPathCoordinates(path.segments[i].point))
            }
            simplePath.remove();

            for(var i=0; i<ImageInfo[currentImage].Regions.length; i++) {
                if(ImageInfo[currentImage].Regions[i].path == tmpPath) {
                    ImageInfo[currentImage].Regions[i] = region;
                }
            }

		    var final_segments = region.path.segments.length;
		    if( debug > 2 ) console.log( parseInt(final_segments/orig_segments*100) + "% segments conserved" );
    	}
    }

    if(selectedTool == "draw" || selectedTool == "select") {
        findContextRegion(region);
    }

    if(ruler) {
        ruler.remove();
    }

    paper.view.draw();
}

/***
    the following functions serve changing the annotation style
***/
var annotationColorLabel;
// add leading zeros
function pad(number, length) {
    var str = '' + number;
    while( str.length < length )
        str = '0' + str;
    return str;
}

/*** get current alpha & color values for colorPicker display
***/
function annotationStyle(label) {
    if( debug ) console.log("> changing annotation style");

    annotationColorLabel = label;
    var alpha = label.alpha;
    $('#alphaSlider').val(alpha*100);
    $('#alphaFill').val(parseInt(alpha*100));

    var hexColor = '#' + pad(( parseInt(label.color.red) ).toString(16),2) + pad(( parseInt(label.color.green) ).toString(16),2) + pad(( parseInt(label.color.blue) ).toString(16),2);
    if( debug ) console.log(hexColor);

    $('#fillColorPicker').val( hexColor );

    if( $('#colorSelector').css('display') == 'none' ) {
        $('#colorSelector').css('display', 'block');
    }
    else {
        $('#colorSelector').css('display', 'none');
    }
}

/*** set picked color & alpha
***/
function setRegionColor() {
    var hexColor = $('#fillColorPicker').val();
    var red = parseInt( hexColor.substring(1,3), 16 );
    var green = parseInt( hexColor.substring(3,5), 16 );
    var blue = parseInt( hexColor.substring(5,7), 16 );
    annotationColorLabel.alpha = $('#alphaSlider').val() / 100;
    // update region tag
    $(".region-tag#" + annotationColorLabel.uid + ">.region-color").css('background-color','rgba('+red+','+green+','+blue+',0.67)');
    $('#colorSelector').css('display', 'none');
}

/*** update all values on the fly
***/
function onFillColorPicker(value) {
    $('#fillColorPicker').val(value);
    var hexColor = $('#fillColorPicker').val();
    annotationColorLabel.color.red = parseInt( hexColor.substring(1,3), 16 );
    annotationColorLabel.color.green = parseInt( hexColor.substring(3,5), 16);
    annotationColorLabel.color.blue = parseInt( hexColor.substring(5,7), 16);
    annotationColorLabel.alpha = $('#alphaSlider').val() / 100;

    for(var i=0; i<ImageInfo[0].Regions.length; i++) {
        var reg = ImageInfo[0].Regions[i];
        if(reg.uid == annotationColorLabel.uid) {
            // change region color
            reg.path.fillColor = 'rgba(' + annotationColorLabel.color.red + ',' + annotationColorLabel.color.green +
                ',' + annotationColorLabel.color.blue + ',' + annotationColorLabel.alpha + ')';
        }
    }

    paper.view.draw();
}

function onAlphaSlider(value) {
    $('#alphaFill').val(value);
    annotationColorLabel.alpha = $('#alphaSlider').val() / 100;
    paper.view.draw();
}

function onAlphaInput(value) {
    $('#alphaSlider').val(value);
    annotationColorLabel.alpha = $('#alphaSlider').val() / 100;
    paper.view.draw();
}

/*** UNDO ***/

/**
 * Command to actually perform an undo.
 */
function cmdUndo() {
    if( UndoStack.length > 0 ) {
        var redoInfo = getUndo();
        var undoInfo = UndoStack.pop();
        applyUndo(undoInfo);
        RedoStack.push(redoInfo);
        paper.view.draw();
    }
}

/**
 * Command to actually perform a redo.
 */
function cmdRedo() {
    if( RedoStack.length > 0 ) {
        var undoInfo = getUndo();
        var redoInfo = RedoStack.pop();
        applyUndo(redoInfo);
        UndoStack.push(undoInfo);
        paper.view.draw();
    }
}

/**
 * Return a complete copy of the current state as an undo object.
 */
function getUndo() {
    var undo = { imageNumber: currentImage, regions: [], drawingPolygonFlag: drawingPolygonFlag };
    var info = ImageInfo[currentImage]["Regions"];

    for( var i = 0; i < info.length; i++ ) {
	    var el;
		if(info[i].path) {
			el = {
				json: JSON.parse(info[i].path.exportJSON()),
				name: info[i].name,
				selected: info[i].path.selected,
				fullySelected: info[i].path.fullySelected,
                context: info[i].context
			}

		} else {
			el = {
				x: info[i].point.x,
				y: info[i].point.y,
				name: info[i].name
			}
		}
		undo.regions.push(el);
    }
    return undo;
}

/**
 * Save an undo object. This has the side-effect of initializing the
 * redo stack.
 */
function saveUndo(undoInfo) {
	UndoStack.push(undoInfo);
	RedoStack = [];
}

function setImage(imageNumber) {
    if( debug ) console.log("> setImage");
    var index = imageOrder.indexOf(imageNumber);

    // update image slider
    update_slider_value(index);

    loadImage(imageOrder[index]);
}

/**
 * Restore the current state from an undo object.
 */
function applyUndo(undo) {
    if( undo.imageNumber !== currentImage )
        setImage(undo.imageNumber);
    var info = ImageInfo[undo.imageNumber]["Regions"];
    while( info.length > 0 )
        removeRegion(info[0], undo.imageNumber);
    region = null;
    for( var i = 0; i < undo.regions.length; i++ ) {
        var el = undo.regions[i];
        if(el.json) {
        	var project = paper.projects[ImageInfo[undo.imageNumber]["projectID"]];
			/* Create the path and add it to a specific project.
			 */
			var path = new paper.Path();
			project.addChild(path);
			path.importJSON(el.json);
			reg = newRegion({name:el.name, path:path, context:el.context}, undo.imageNumber);
		    // here order matters. if fully selected is set after selected, partially selected paths will be incorrect
	  		reg.path.fullySelected = el.fullySelected;
	 		reg.path.selected = el.selected;
			if( el.selected ) {
				if( region === null )
					region = reg;
				else
					console.log("Should not happen: two regions selected?");
			}
        } else {
        	reg = newRegion({name:el.name, x:el.x, y:el.y}, undo.imageNumber);
        	viewer.addOverlay(reg.img, reg.point);
        }

    }
    drawingPolygonFlag = undo.drawingPolygonFlag;
    updateRegionList();
}

/**
 * If we have actually made a change with a mouse operation, commit
 * the undo information.
 */
function commitMouseUndo() {
    if( mouseUndo !== undefined ) {
        saveUndo(mouseUndo);
        mouseUndo = undefined;
    }
}


/***3
    Tool selection
*/

function finishDrawingPolygon(closed){
    // finished the drawing of the polygon
    if( closed == true ) {
        region.path.closed = true;
        region.path.fillColor.alpha = config.defaultFillAlpha;
    } else {
        region.path.fillColor.alpha = 0;
    }
    region.path.fullySelected = true;
    //region.path.smooth();
    drawingPolygonFlag = false;
    commitMouseUndo();
}

function backToPreviousTool(prevTool) {
    setTimeout(function() {
        selectedTool = prevTool;
        selectTool()
    },500);
}

function backToSelect() {
    setTimeout(function() {
        selectedTool = "select";
        selectTool()
    },500);
}

/**
 * This function deletes the currently selected object.
 */
function cmdDeleteSelected() {
    var undoInfo = getUndo();
    var i;
    for( i in ImageInfo[currentImage]["Regions"] ) {
        if( ImageInfo[currentImage]["Regions"][i] == region ) {
            removeRegion(ImageInfo[currentImage]["Regions"][i]);
            saveUndo(undoInfo);
            paper.view.draw();
            break;
        }
    }
}

function cmdPaste() {
    if( copyRegion !== null ) {
        var undoInfo = getUndo();
        saveUndo(undoInfo);
        console.log( "paste " + copyRegion.name );
        if( findRegionByName(copyRegion.name) ) {
            copyRegion.name += " Copy";
        }
        var reg = JSON.parse(JSON.stringify(copyRegion));
        reg.path = new paper.Path();
        reg.path.importJSON(copyRegion.path);
        reg.path.fullySelected = true;
        var color = regionHashColor(reg.name);
        reg.path.fillColor = 'rgba(' + color.red + ',' + color.green + ',' + color.blue + ',0.5)';
        newRegion({name:copyRegion.name,path:reg.path});
    }
    paper.view.draw();
}

function cmdCopy() {
    if( region !== null ) {
    var json = region.path.exportJSON();
    copyRegion = JSON.parse(JSON.stringify(region));
    copyRegion.path = json;
    console.log( "< copy " + copyRegion.name );
    }
}

function clearToolSelection() {
	selectedTool = "navigate";
    selectTool();
	navEnabled = true;
}

function toolSelection(event) {
    if( debug ) console.log("> toolSelection");

    //end drawing of polygons and make open form
    if( drawingPolygonFlag == true )
        finishDrawingPolygon(true);

    var prevTool = selectedTool;
    selectedTool = $(this).attr("id");
    selectTool();

    switch(selectedTool) {
        case "select":
        case "draw":
        case "draw-polygon":
        case "addpoi":
            navEnabled = false;
            break;
        case "distance":
            navEnabled = false;
            break;
        case "navigate":
            navEnabled = true;
            handle = null;
            break;
        case "save":
            saveRegions();
            backToPreviousTool(prevTool);
            break;
        case "home":
            backToPreviousTool(prevTool);
            break;
        case "closeMenu":
            toggleMenu();
            backToPreviousTool(prevTool);
            break;
        case "openMenu":
            toggleMenu();
            backToPreviousTool(prevTool);
            break;
    }
}

function selectTool() {
    if( debug ) console.log("> selectTool");

    $("img.button").removeClass("selected");
    $("img.button#" + selectedTool).addClass("selected");
}


/***4
    Annotation storage
*/

function saveJson(json, filePath) {
    console.log("> writing json to file");
    var source = getJsonSource();
    $.ajax({
        type : "POST",
        url : "/saveJson",
        data : {
            json : JSON.stringify(json),
            source: filePath
        }

    });
    console.log("< writing json to file");
}

function saveConfig() {
    saveJson(config, "configuration.json");
}

function saveDictionary() {
    saveJson(labelDictionary, "dictionaries/" + config.dictionary);
}

function getJsonSource() {
    return slide.name + ".json";
}

function saveRegions() {
    saveJson(ImageInfo[currentImage]["Regions"], "wsi/" + getJsonSource());
}

function loadJson() {
    console.log("> loading json from " + getJsonSource());
    $.ajax({
        type : "GET",
        url : "/loadJson?src="+getJsonSource(),
    }).done(function (json) {
        var regions = JSON.parse(json);
        for(var i=0; i<regions.length; i++) {
            var region = regions[i];
            var path = new paper.Path();
            path.importJSON(regions[i].path);
            region.path = path;
            region.context = regions[i].context;
            newRegion(region);
        }
        paper.view.draw();
    });
    console.log("< loading json from " + getJsonSource());
}

/***5
    Initialisation
*/

function loadImage(name) {
    if( debug ) console.log("> loadImage(" + name + ")");
    // save previous image for some (later) cleanup
    prevImage = currentImage;

    // set current image to new image
    currentImage = name;

    viewer.open(ImageInfo[currentImage]["source"]);
}

function resizeAnnotationOverlay() {
    if( debug ) console.log("> resizeAnnotationOverlay");

    var width = $("body").width();
    var height = $("body").height();
    $("canvas.overlay").width(width);
    $("canvas.overlay").height(height);
    paper.view.viewSize = [width,height];
}

function initAnnotationOverlay(data) {
    if( debug ) console.log("> initAnnotationOverlay");

    // do not start loading a new annotation if a previous one is still being loaded
    if(annotationLoadingFlag==true) {
        return;
    }

    //console.log("new overlay size" + viewer.world.getItemAt(0).getContentSize());

    /*
       Activate the paper.js project corresponding to this slice. If it does not yet
       exist, create a new canvas and associate it to the new project. Hide the previous
       slice if it exists.
    */
    currentImage = 0;

    // change myOrigin (for loading and saving)
    myOrigin.slice = currentImage;

    // hide previous slice
    if( prevImage && paper.projects[ImageInfo[prevImage]["projectID"]] ) {
        paper.projects[ImageInfo[prevImage]["projectID"]].activeLayer.visible = false;
        $(paper.projects[ImageInfo[prevImage]["projectID"]].view.element).hide();
    }

    // if this is the first time a slice is accessed, create its canvas, its project,
    // and load its regions from the database
    if( ImageInfo[currentImage]["projectID"] == undefined ) {

        // create canvas
        var canvas = $("<canvas class='overlay' id='" + currentImage + "'>");
        $("body").append(canvas);

        // create project
        paper.setup(canvas[0]);
        ImageInfo[currentImage]["projectID"] = paper.project.index;

        // load regions from database
        if( config.useDatabase ) {
            microdrawDBLoad()
            .then(function(){
                $("#regionList").height($(window).height() - $("#regionList").offset().top);
                updateRegionList();
                paper.view.draw();
            });
        }

        if( debug ) console.log('Set up new project, currentImage: ' + currentImage + ', ID: ' + ImageInfo[currentImage]["projectID"]);
    }

    // activate the current slice and make it visible
    paper.projects[ImageInfo[currentImage]["projectID"]].activate();
    paper.project.activeLayer.visible = true;
    $(paper.project.view.element).show();

    // resize the view to the correct size
    var width = $("body").width();
    var height = $("body").height();
    paper.view.viewSize = [width, height];
    paper.settings.handleSize = 10;
    updateRegionList();
    paper.view.draw();

    /* RT: commenting this line out solves the image size issues */
       // set size of the current overlay to match the size of the current image
       // magicV = viewer.world.getItemAt(0).getContentSize().x / 100;

    transform();
}

function transform() {
    //if( debug ) console.log("> transform");

    var z = viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom(true));
    var sw = viewer.source.width;
    var bounds = viewer.viewport.getBounds(true);
    var x = magicV * bounds.x;
    var y = magicV * bounds.y;
    var w = magicV * bounds.width;
    var h = magicV * bounds.height;
    paper.view.setCenter(x + w / 2, y + h / 2);
    paper.view.zoom=(sw * z) / magicV;
}

function loadConfiguration() {
    var def = $.Deferred();
    // load general microdraw configuration
    $.getJSON(staticPath + "/configuration.json", function(data) {
        config = data;

        // set default values for new regions (general configuration)
        config.defaultStrokeColor = 'black';
        config.defaultStrokeWidth = 1;
        config.defaultFillAlpha = 0.5;

        // get list of dictionaries
        getDictionaryList();

        // load label dictionary
        loadDictionary(staticPath + "/dictionaries/" + config.dictionary);

        drawingTools = ["select", "draw", "draw-polygon", "save", "addpoi"];
        if( config.drawingEnabled == false ) {
            // remove drawing tools from ui
            for( var i = 0; i < drawingTools.length; i++ ){
                $("#" + drawingTools[i]).remove();
            }

        }
        for( var i = 0; i < config.removeTools.length; i++ ) {
            $("#" + config.removeTools[i]).remove();
        }
        if( config.useDatabase == false ) {
            $("#save").remove();
        }
        def.resolve();
    });

    return def.promise();
}

function toggleDictPicker() {
    var dictListContent = $('#dicts_content');
    dictListContent.is(":visible") ? dictListContent.hide() : dictListContent.show();
}

function dictListClick(index) {
    config.dictionary = dictionaries[index];
    saveConfig();
    loadDictionary(staticPath + "/dictionaries/" + dictionaries[index]);
}

function getDictionaryList() {
    $.ajax({
        url: "/getDictionaries",
        dataType: "json",
        success: function (localDicts) {
            var content = "";
            dictionaries = localDicts;
            for( var i in dictionaries) {
                content += '<p class="dictListEntry" onClick="dictListClick(' + i + ')">'+dictionaries[i]+'</p>';
            }
            $('#dicts_content').html(content);
        }
    });
}

function loadDictionary(path) {
    $.ajax({
        url: path,
        dataType: "json",
        success: function (dictionary) {
            labelDictionary = dictionary;
            $('#currentDictName').html(config.dictionary);
            appendLabelsToList();
        },
        error: function (data) {
            createNewDictionary(false);
        }
    });
}

function initAnnotationService() {

    if( debug ) console.log("> initAnnotationService promise");

    var def = $.Deferred();

    // Enable click on toolbar buttons
    $("img.button").click(toolSelection);

    // set annotation loading flag to false
    annotationLoadingFlag = false;

    // Configure currently selected tool
    selectedTool = "navigate";
    selectTool();

    // set up the ImageInfo array and imageOrder array
    currentImage = 0;
    ImageInfo[currentImage] = {"Regions": [], "projectID": undefined};

    // load image viewer
    viewer = OpenSeadragon({
        id: "openseadragon1",
        prefixUrl: staticPath + "/lib/openseadragon/images/",
        showReferenceStrip: false,
        referenceStripSizeRatio: 0.2,
        showNavigator: true,
        sequenceMode: false,
        navigatorId:"myNavigator",
        homeButton:"home",
        preserveViewport: true,
        zoomPerClick: 1,
    });

    var mpp = 0;
    if(slide.mpp) {
        mpp = slide.mpp > 0 ? (1e6 / slide.mpp) : 0
    }

    viewer.scalebar({
        type: OpenSeadragon.ScalebarType.MICROSCOPE,
        minWidth:'150px',
        pixelsPerMeter:mpp,
        color:'black',
        fontColor:'black',
        backgroundColor:"rgba(255,255,255,0.5)",
        barThickness:4,
        location: OpenSeadragon.ScalebarLocation.TOP_RIGHT,
        xOffset:5,
        yOffset:5
    });

    // open the currentImage
    if(slide.url.indexOf("/wsi/") !== -1)
        viewer.open(staticPath + slide.url);
    else
        viewer.open(slide.url);

    // add handlers: update slice name, animation, page change, mouse actions
    viewer.addHandler('open',function(){
        initAnnotationOverlay();
        $("title").text(slide.name);

        // todo: check if true:
        // To improve load times, ignore the lowest-resolution Deep Zoom
        // levels.  This is a hack: we can't configure the minLevel via
        // OpenSeadragon configuration options when the viewer is created
        // from DZI XML.
        viewer.source.minLevel = 8;

        // load saved annotations and pois
        loadJson();
    });
    viewer.addHandler('animation', function(event){
        transform();
    });
    viewer.addHandler("page", function (data) {
        console.log(data.page,params.tileSources[data.page]);
    });
    viewer.addViewerInputHook({hooks: [
        {tracker: 'viewer', handler: 'clickHandler', hookHandler: clickHandler},
        {tracker: 'viewer', handler: 'pressHandler', hookHandler: pressHandler},
        {tracker: 'viewer', handler: 'dragHandler', hookHandler: dragHandler},
        {tracker: 'viewer', handler: 'dragEndHandler', hookHandler: dragEndHandler}
    ]});

    // Show and hide menu
    if( config.hideToolbar ) {
        var mouse_position;
        var animating = false;
        $(document).mousemove(function (e) {
            if( animating ) {
                return;
            }
            mouse_position = e.clientX;

            if( mouse_position <= 100 ) {
                //SLIDE IN MENU
                animating = true;
                $('#menuBar').animate({
                    left: 0,
                    opacity: 1
                }, 200, function () {
                    animating = false;
                });
            } else if( mouse_position > 200 ) {
                animating = true;
                $('#menuBar').animate({
                    left: -100,
                    opacity: 0
                }, 500, function () {
                    animating = false;
                });
            }
        });
    }

    $(window).resize(function() {
        $("#regionList").height($(window).height() - $("#regionList").offset().top);
        resizeAnnotationOverlay();
    });

    return def.promise();
}

function toggleMenu () {
    if( $('#menuBar').css('display') == 'none' ) {
        $('#menuBar').css('display', 'block');
        $('#menuButton').css('display', 'none');
    }
    else {
        $('#menuBar').css('display', 'none');
        $('#menuButton').css('display', 'block');
    }
}

// key listener

$(document).keydown(function(e) {
    if(e.keyCode == 9) {
        // tab
        e.preventDefault();
        selectNextLabel();
    } else if(e.keyCode == 16) {
        // shift
        $('body').css('cursor','cell');
        selectToolOnKeyPress("addpoi");
    } else if(e.keyCode == 17) {
        // ctrl
        $('body').css('cursor','url(/static/cursors/drawFree.png),auto');
        selectToolOnKeyPress("draw");
    } else if(e.keyCode == 18 || e.keyCode == 225) {
        // alt || alt gr
        $('body').css('cursor','move');
        selectToolOnKeyPress("select");
    } else if(e.keyCode == 27) {
        // esc
        var dictListContent = $('#dicts_content');
        if(dictListContent.is(":visible")) {
            dictListContent.hide()
        } else {
            deselectRegion(region);
        }
    } else if (e.keyCode == 46) {
        cmdDeleteSelected();
    } else if(e.keyCode == 68) {
        // ctrl + d
        if(e.ctrlKey) {
            e.preventDefault();
            if(selectedTool == "draw") {
                $('body').css('cursor','url(/static/cursors/drawPoly.png),auto');
                selectToolOnKeyPress("draw-polygon");
            } else {
                $('body').css('cursor','url(/static/cursors/drawFree.png),auto');
                selectToolOnKeyPress("draw");
            }
        }
    } else if(e.keyCode == 81) {
        // ctrl + q
        if(e.ctrlKey) {
            e.preventDefault();
            if(selectedTool == "draw") {
                $('body').css('cursor','url(/static/cursors/ruler.png),auto');
                selectToolOnKeyPress("distance");
            } else {
                $('body').css('cursor','url(/static/cursors/drawFree.png),auto');
                selectToolOnKeyPress("draw");
            }
        }
    } else if(e.keyCode == 83) {
        // ctrl + s
        if(e.ctrlKey) {
            e.preventDefault();
            saveRegions();
        }
    } else if(e.keyCode == 107) {
        e.preventDefault();
        e.stopPropagation();
        if(e.ctrlKey && e.shiftKey) {
            // ctrl + shift + "+"
            createNewDictionary(true);
        } else if(e.ctrlKey) {
            // ctrl + "+"
            var label = newLabel();
            if(label) {
                appendLabelToList(label);
            }
        }
        clearToolSelection();
    }
});

function selectToolOnKeyPress(id) {
    tmpTool = selectedTool;
    selectedTool = id;
    navEnabled = false;
    selectTool();
}

function createNewDictionary(isCancelable) {
    // get name for new dictionary
    var name = "";
    while(name.length == 0) {
        name = prompt("Enter new name for new dictionary", "dictionary");
        if(name === null) {
            // user hits "cancel" in prompt
            if(isCancelable) {
                name = null;
                break;
            } else {
                name = "";
                alert("No dictionary found. Please enter a valid name to create one.");
            }

        }
    }
    if(name) {
        if(name.indexOf(".json") === -1) {
            name = name + ".json"
        }
        // request creation of new dictionary and path to it
        $.ajax({
            type : "GET",
            url : "/createDictionary?name="+name,
        }).done(function (response) {
            if(response === "error") {
                alert("Couldn't create dictionary since there is already a dictionary with that name!");
            } else {
                var json = JSON.parse(response);
                var path = json["path"];
                var name = json["name"];
                config.dictionary = name;
                loadDictionary(path);
                getDictionaryList();
            }
        });
    }
}

$(document).keyup(function(e) {
    var elDist = document.getElementById("distance-tooltip");
    if(elDist) {
        elDist.parentNode.removeChild(elDist);
    }
    var elArea = document.getElementById("area-tooltip");
    if(elArea) {
        elArea.parentNode.removeChild(elArea);
    }
    if(e.keyCode == 16 || e.keyCode == 17 || e.keyCode == 18 || e.keyCode == 225) {
        $('body').css('cursor','auto');
        // shift || ctrl || alt || alt gr
        selectedTool = tmpTool;
        navEnabled = true;
        selectTool();
        if(ruler) {
            ruler.remove();
            paper.view.draw();
        }
    }
});

function init(file_name, url, mpp) {
    slide = {"name":file_name, "url":url, "mpp":mpp};
    staticPath = "/static";
    loadConfiguration();
    initAnnotationService();
}
