//(function() {                 // force everything local.
var debug = 1;

//var dbroot = "http://"+localhost+"/microdraw/php/microdraw_db.php";
var ImageInfo = {};             // regions, and projectID (for the paper.js canvas) for each slices, can be accessed by the slice name. (e.g. ImageInfo[imageOrder[viewer.current_page()]])
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
var	myIP;			            // user's IP
var UndoStack = [];
var RedoStack = [];
var mouseUndo;                  // tentative undo information.
var shortCuts = [];             // List of shortcuts
var newRegionFlag;	            // true when a region is being drawn
var drawingPolygonFlag = false; // true when drawing a polygon
var annotationLoadingFlag;      // true when an annotation is being loaded
var config = {}                 // App configuration object
var isMac = navigator.platform.match(/Mac/i)?true:false;
var isIOS = navigator.platform.match(/(iPhone|iPod|iPad)/i)?true:false;

/*** 
	AnnotationService variables
*/
var regionDictionary = [];

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

    path.add(new paper.Point(x, y));
    path.add(new paper.Point(x-1, y-3));
    path.add(new paper.Point(x, y-2));
    path.add(new paper.Point(x+1, y-3));
    path.closed = true;

    return path;
}

function newRegion(arg, imageNumber) {
	if( debug ) console.log("> newRegion");
    var reg = {};
    if(arg.uid) {
        reg.uid = arg.uid;
    } else {
        reg.uid = uniqueID();
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
        reg.path = newPoi(reg.point, reg.name, arg.path)
	}
	else {
		// regular region
		if( arg.name ) {
			reg.name = arg.name;
		}
		else {
			reg.name = "Untitled " + reg.uid;
		}
		var color = regionHashColor(reg.name);
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
	if( imageNumber === currentImage ) {
		// append region tag to regionList
		var el = $(regionTag(reg.name,reg.uid,reg.context, reg.path.fillColor));
		$("#regionList").append(el);

		// handle single click on computers
		el.click(singlePressOnRegion);
	
		// handle double click on computers
		el.dblclick(doublePressOnRegion);
	
		// handle single and double tap on touch devices
		/*
		  RT: it seems that a click event is also fired on touch devices,
		  making this one redundant
		*/
		el.on("touchstart",handleRegionTap);
	}

    // Select region name in list
    $("#regionList > .region-tag").each(function(i){
        $(this).addClass("deselected");
        $(this).removeClass("selected");
    });

    var tag = $("#regionList > .region-tag#" + reg.uid);
    $(tag).removeClass("deselected");
    $(tag).addClass("selected");

	// push the new region to the Regions array
	ImageInfo[imageNumber]["Regions"].push(reg);
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
	} else {
		// remove point
		viewer.removeOverlay(reg.img);
	}
	if( imageNumber == currentImage ) {
		// remove from regionList
		var	tag = $("#regionList > .region-tag#" + reg.uid);
		$(tag).remove();
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
    updateRegionList();
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

    // Select region name in list
    $("#regionList > .region-tag").each(function(i){
        $(this).addClass("deselected");
        $(this).removeClass("selected");
    });

    var tag = $("#regionList > .region-tag#" + reg.uid);
    $(tag).removeClass("deselected");
    $(tag).addClass("selected");

    if(debug) console.log("< selectRegion");
}

function selectNextRegion() {
    var regions = ImageInfo[0].Regions;
    var index = 0;
    if(region) {
        for(var i=0; i<regions.length; i++) {
            if(region.uid == regions[i].uid && i+1 < regions.length) {
                index = i + 1;
                break;
            }
        }
    }
    selectRegion(regions[index]);
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

var counter = 1;
function uniqueID() {
    if( debug ) console.log("> uniqueID");

    var i;
    var found = false;
    while( found == false ) {
        found = true;
        for( i = 0; i < ImageInfo[currentImage]["Regions"].length; i++ ) {
            if( ImageInfo[currentImage]["Regions"][i].uid == counter ) {
                counter++;
                found = false;
                break;
            }
        }
    }
    return counter;
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

function regionTag(name,uid,context,fillColor) {
    //if( debug ) console.log("> regionTag");

    var str;
    var color = regionHashColor(name);
    if( uid ) {
        var reg = findRegionByUID(uid);
        var mult = 1.0;
        if(fillColor) {
            mult = 255;
            color = fillColor;
        } else if( reg ) {
            mult = 255;
            color = reg.path.fillColor;
        } else {
            color = regionHashColor(name);
        }
        str = [ "<div class='region-tag' id='" + uid + "' style='padding:2px'>",
            "<img class='eye' title='Region visible' id='eye_" + uid + "' src='img/eyeOpened.svg' />",
            "<div class='region-color' id='color_" + uid + "'",
            "style='background-color:rgba(",
            parseInt(color.red*mult),",",parseInt(color.green*mult),",",parseInt(color.blue*mult),",0.67",
            ")'></div>",
            "<span class='region-name' id='name_" + uid + "'>" + name + "</span><br/>",
        ].join(" ");

        if(context) {
            for (var i = 0; i < context.length; i++) {
                var contextName = "error fetching context";
                if(isNaN(context[i])) {
                    contextName = context[i];
                } else {
                    var contextRegion = findRegionByUID(context[i]);
                    if(contextRegion) {
                        contextName = contextRegion.name;
                    }
                }

                str += "<img class='eye' style='margin-right:10px' title='Remove context' id='removeContext_" + uid + "/" + i + "' src='img/remove.svg' />";
                str += "<span class='context-name' id='context_" + uid + "/" + i + "'>" + contextName + "</span></br>";
            }
        }

        str += "<img class='eye' title='Add context' id='addContext_" + uid + "' src='img/add.svg' />";
        str += "</div>";
    }
    else {
        color = regionHashColor(name);
        str = [ "<div class='region-tag' style='padding:2px'>",
                "<div class='region-color'",
                "style='background-color:rgba(",
                color.red,",",color.green,",",color.blue,",0.67",
                ")'></div>",
                "<span class='region-name'>" + name + "</span>",
                "</div>",
                ].join(" ");
    }

    return str;
}

function appendRegionTagsFromDictionary() {
    if( debug ) console.log("> appendRegionTagsFromDictionary");
    var dic = regionDictionary;
    // get headers and parts lists
    for( var i = 0; i < dic.length; i++ ) {
        if(dic[i].header) {
            $("#regionPicker").append("<div>"+dic[i].header+"</div>");
        }
        if(dic[i].parts) {
            for(var j = 0; j < dic[i].parts.length; j++) {
                var tag = regionTag(dic[i].parts[j]);
                var el = $(tag).addClass("ontology");
                $("#regionPicker").append(el);

                // handle single click on computers
                el.click(singlePressOnRegion);

                el.on("touchstart",handleRegionTap);
            }
        }
    }
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
}

/*** toggle visibility of region
***/
function toggleRegion(reg) {
    if( region !== null ) {
        if( debug ) console.log("> toggle region"); 
		
        if( reg.path.fillColor !== null ) {
            reg.path.storeColor = reg.path.fillColor;
            reg.path.fillColor = null;

            reg.path.storeWidth = reg.path.strokeWidth;
            reg.path.strokeWidth = 0;
            reg.path.fullySelected = false;
            reg.storeName = reg.name;
            //reg.name=reg.name+'*';
            $('#eye_' + reg.uid).attr('src','img/eyeClosed.svg');
        }
        else {
            reg.path.fillColor = reg.path.storeColor;
            reg.path.strokeWidth = reg.path.storeWidth;
            reg.name = reg.storeName;
            $('#eye_' + reg.uid).attr('src','img/eyeOpened.svg');
        }
        paper.view.draw();

        $(".region-tag#" + reg.uid + ">.region-name").text(reg.name);
    }
}

function updateRegionList() {
    if( debug ) console.log("> updateRegionList");

    // remove all entries in the regionList
    $("#regionList > .region-tag").each(function() {
        $(this).remove();
    });

    // adding entries corresponding to the currentImage
    for( var i = 0; i < ImageInfo[currentImage]["Regions"].length; i++ ) {
        var reg = ImageInfo[currentImage]["Regions"][i];
        // append region tag to regionList
        var el = $(regionTag(reg.name,reg.uid, reg.context));
        $("#regionList").append(el);

        // handle single click on computers
        el.click(singlePressOnRegion);
        // handle double click on computers
        el.dblclick(doublePressOnRegion);
        // handle single and double tap on touch devices
        el.on("touchstart",handleRegionTap);
    }
}

function checkRegionSize(reg) {
    if( reg.path.length > 3 ) {
        return;
    }
    else {
        removeRegion(region, currentImage);
    }
}


/***2
    Interaction: mouse and tap
*/
function clickHandler(event){
    if( debug ) {
    	console.log("> clickHandler");
    	var webPoint = event.position;
		var viewportPoint = viewer.viewport.pointFromPixel(webPoint);
		console.log(">    "+webPoint+")");
		console.log(">    "+viewportPoint+")");
	}
    event.stopHandlers = !navEnabled;
    if( selectedTool == "draw") {
        checkRegionSize(region);
    }
    else if( selectedTool == "addpoi") {
		var undoInfo = getUndo();
		saveUndo(undoInfo);
		//mouseUndo = getUndo();
		//commitMouseUndo();
		addPoi(event);
	}
}

function addPoi(event) {
	var webPoint = event.position;
    var point = paper.view.viewToProject(new paper.Point(webPoint.x,webPoint.y));
	newRegion(point);
    paper.view.draw();
}

function pressHandler(event){
    if( debug ) console.log("> pressHandler");

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
            toggleRegion(findRegionByUID(this.id));
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
        toggleRegion(reg);
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

    if(selectedTool == "select") {
        var hitResult = paper.project.hitTest(point, {
            tolerance: 10,
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
        for( i in ImageInfo[currentImage]["Regions"] ) {
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
    var point1 = ruler.segments[0].point;
    var point2 = ruler.segments[1].point;
    var pxDistance = Math.sqrt(Math.pow(point2.x - point1.x, 2) + Math.pow(point2.y - point1.y, 2));
    var mpp = (mpp_x * mpp_y) / objPower;

    return Math.round(((pxDistance * mpp) * 1000) * 100) / 100;
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
		    region.path.fullySelected = true;
		    // to delete all unnecessary segments while preserving the form of the region to make it modifiable; & adding handles to the segments
		    var orig_segments = region.path.segments.length;
		    region.path.simplify(0);
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
var currentColorRegion;
// add leading zeros
function pad(number, length) { 
    var str = '' + number; 
    while( str.length < length ) 
        str = '0' + str; 
    return str; 
}
/*** get current alpha & color values for colorPicker display 
***/
function annotationStyle(reg) {
    if( debug ) console.log(reg.path.fillColor);

    if( region !== null ) {
        if( debug ) console.log("> changing annotation style");
        
        currentColorRegion = reg;
        var alpha = reg.path.fillColor.alpha;
        $('#alphaSlider').val(alpha*100);
        $('#alphaFill').val(parseInt(alpha*100));

        var hexColor = '#' + pad(( parseInt(reg.path.fillColor.red * 255) ).toString(16),2) + pad(( parseInt(reg.path.fillColor.green * 255) ).toString(16),2) + pad(( parseInt(reg.path.fillColor.blue * 255) ).toString(16),2);
        if( debug ) console.log(hexColor);
        
        $('#fillColorPicker').val( hexColor );

        if( $('#colorSelector').css('display') == 'none' ) {
            $('#colorSelector').css('display', 'block');
        }
        else {
            $('#colorSelector').css('display', 'none');
        }
    }
}
/*** set picked color & alpha 
***/
function setRegionColor() {
    var reg = currentColorRegion;
    var hexColor = $('#fillColorPicker').val();
    var red = parseInt( hexColor.substring(1,3), 16 );
    var green = parseInt( hexColor.substring(3,5), 16 );
    var blue = parseInt( hexColor.substring(5,7), 16 );

    reg.path.fillColor.red = red / 255;
    reg.path.fillColor.green = green / 255;
    reg.path.fillColor.blue = blue / 255;
    reg.path.fillColor.alpha = $('#alphaSlider').val() / 100;
    
    // update region tag
    $(".region-tag#" + reg.uid + ">.region-color").css('background-color','rgba('+red+','+green+','+blue+',0.67)');
  
    // update stroke color
    switch( $('#selectStrokeColor')[0].selectedIndex ) {
        case 0:
            reg.path.strokeColor = "black";
            break;
        case 1:
            reg.path.strokeColor = "white";
            break;
        case 2:
            reg.path.strokeColor = "red";
            break;
        case 3:
            reg.path.strokeColor = "green";
            break;
        case 4:
            reg.path.strokeColor = "blue";
            break;
        case 5:
            reg.path.strokeColor = "yellow";
            break;
    }
    $('#colorSelector').css('display', 'none');
}
/*** update all values on the fly 
***/
function onFillColorPicker(value) {
    $('#fillColorPicker').val(value);
    var reg = currentColorRegion;
    var hexColor = $('#fillColorPicker').val();
    var red = parseInt( hexColor.substring(1,3), 16 );
    var green = parseInt( hexColor.substring(3,5), 16);
    var blue = parseInt( hexColor.substring(5,7), 16);
    reg.path.fillColor.red = red / 255;
    reg.path.fillColor.green = green / 255;
    reg.path.fillColor.blue = blue / 255;
    reg.path.fillColor.alpha = $('#alphaSlider').val() / 100;
    paper.view.draw();
}

function onSelectStrokeColor() {
    var reg = currentColorRegion;
    switch( $('#selectStrokeColor')[0].selectedIndex ) {
        case 0:
            reg.path.strokeColor = "black";
            break;
        case 1:
            reg.path.strokeColor = "white";
            break;
        case 2:
            reg.path.strokeColor = "red";
            break;
        case 3:
            reg.path.strokeColor = "green";
            break;
        case 4:
            reg.path.strokeColor = "blue";
            break;
        case 5:
            reg.path.strokeColor = "yellow";
            break;
    }
    paper.view.draw();
}

function onAlphaSlider(value) {
    $('#alphaFill').val(value);
    var reg = currentColorRegion;
    reg.path.fillColor.alpha = $('#alphaSlider').val() / 100;
    paper.view.draw();
}

function onAlphaInput(value) {
    $('#alphaSlider').val(value);
    var reg = currentColorRegion;
    reg.path.fillColor.alpha = $('#alphaSlider').val() / 100;
    paper.view.draw();
}

function onStrokeWidthDec() {
    var reg = currentColorRegion;
    reg.path.strokeWidth = Math.max(region.path.strokeWidth - 1, 1);
    paper.view.draw();
}

function onStrokeWidthInc() {
    var reg = currentColorRegion;
    reg.path.strokeWidth = Math.min(region.path.strokeWidth + 1, 10);
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
				fullySelected: info[i].path.fullySelected
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
			reg = newRegion({name:el.name, path:path}, undo.imageNumber);
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
            // microdrawDBSave();
            saveJson();
            backToPreviousTool(prevTool);
            break;
        case "home":
            backToPreviousTool(prevTool);
            break;
        case "copy":
            cmdCopy();
            //backToPreviousTool(prevTool);
            backToSelect();
            break;
        case "paste":
            cmdPaste();
            //backToPreviousTool(prevTool);
            backToSelect();
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

/* microdrawDB push/pull */
function microdrawDBSave() {
/*
    Save SVG overlay to microdrawDB
*/
    if( debug ) console.log("> save promise");

    // key
    var key = "regionPaths";
    var savedSlices = "Saving slices: ";

    for( var sl in ImageInfo ) {
        if ((config.multiImageSave == false) && (sl != currentImage)){
            continue;
        }
        // configure value to be saved
        var slice = ImageInfo[sl];
        var value = {};
        value.Regions = [];
        for( var i = 0; i < slice.Regions.length; i++ )
        {
            var el = {};
            el.path = JSON.parse(slice.Regions[i].path.exportJSON());
            el.name = slice.Regions[i].name;
            value.Regions.push(el);
        }

        // check if the slice annotations have changed since loaded by computing a hash
        var h = hash(JSON.stringify(value.Regions)).toString(16);
        if( debug > 1 )
            console.log("hash:",h,"original hash:",slice.Hash);
        // if the slice hash is undefined, this slice has not yet been loaded. do not save anything for this slice
        if( slice.Hash == undefined || h==slice.Hash ) {
            if( debug > 1 )
                console.log("No change, no save");
            value.Hash = h;
            continue;
        }
        value.Hash = h;
        savedSlices += sl.toString() + " ";

        // post data to database
        (function(sl, h) {
        console.log('saving slice ', sl);
        $.ajax({
            url:dbroot,
            type:"POST",
            data:{
                "action":"save",
                "origin":JSON.stringify({
                    appName:myOrigin.appName,
                    slice:  sl,
                    source: myOrigin.source,
                    user:   myOrigin.user
                }),
                "key":key,
                "value":JSON.stringify(value)
            },
            success: function(data) {
                console.log("< microdrawDBSave resolve: Successfully saved regions:",ImageInfo[sl].Regions.length,"slice: " + sl.toString(),"response:",data);
                //update hash
                ImageInfo[sl].Hash = h;
            },
            error: function(jqXHR, textStatus, errorThrown) {
                console.log("< microdrawDBSave resolve: ERROR: " + textStatus + " " + errorThrown,"slice: "+sl.toString());
            }
        });
        })(sl, h);

        //show dialog box with timeout
        $('#saveDialog').html(savedSlices).fadeIn();
        setTimeout(function() { $("#saveDialog").fadeOut(500);},2000);
    }
}

function microdrawDBLoad() {
/*
    Load SVG overlay from microdrawDB
*/
	if( debug ) console.log("> microdrawDBLoad promise");
	
	var	def = $.Deferred();
	var	key = "regionPaths";
	var slice = myOrigin.slice;
    $.get(dbroot,{
		"action":"load_last",
		"origin":JSON.stringify(myOrigin),
		"key":key
	}).success(function(data) {
		var	i,obj,reg;
		annotationLoadingFlag = false;
		
		// if the slice that was just loaded does not correspond to the current slice,
		// do not display this one and load the current slice.
		if( slice != currentImage ) {
            microdrawDBLoad()
            .then(function() {
                $("#regionList").height($(window).height()-$("#regionList").offset().top);
                updateRegionList();
                paper.view.draw();
            });
            def.fail();
		    return;
		}
	
        // if there is no data on the current slice 
        // save hash for the image none the less
        if( data.length == 0 ) {
            ImageInfo[currentImage]["Hash"] = hash(JSON.stringify(ImageInfo[currentImage]["Regions"])).toString(16);
            return;
        }
        
		// parse the data and add to the current canvas
		// console.log("[",data,"]");
        obj = JSON.parse(data);
		if( obj ) {
			obj = JSON.parse(obj.myValue);
			for( i = 0; i < obj.Regions.length; i++ ) {
				var reg = {};
				var	json;
				reg.name = obj.Regions[i].name;
				reg.page = obj.Regions[i].page;
				json = obj.Regions[i].path;
				reg.path = new paper.Path();
				reg.path.importJSON(json);
				newRegion({name:reg.name,path:reg.path});
			}
			paper.view.draw();
            // if image has no hash, save one
			ImageInfo[currentImage]["Hash"] = (obj.Hash ? obj.Hash : hash(JSON.stringify(ImageInfo[currentImage]["Regions"])).toString(16));
    
		}
		if( debug ) console.log("< microdrawDBLoad resolve success. Number of regions:", ImageInfo[currentImage]['Regions'].length);
		def.resolve();
	}).error(function(jqXHR, textStatus, errorThrown) {
        console.log("< microdrawDBLoad resolve ERROR: " + textStatus + " " + errorThrown);
		annotationLoadingFlag = false;
    });
    return def.promise();
}

function microdrawDBIP() {
/*
    Get my IP
*/
    if( debug ) console.log("> microdrawDBIP promise");

    $("#regionList").html("<br />Connecting to database...");
    return $.get(dbroot,{
        "action":"remote_address"
    }).success(function(data) {
        if( debug ) console.log("< microdrawDBIP resolve: success");
        $("#regionList").html("");
        myIP = data;
    }).error(function(jqXHR, textStatus, errorThrown) {
        console.log("< microdrawDBIP resolve: ERROR, " + textStatus + ", " + errorThrown);
        $("#regionList").html("<br />Error: Unable to connect to database.");
    });
}

function save() {
    if( debug ) console.log("> save");

    var i;
    var obj;
    var el;

    obj = {};
    obj.Regions = [];
    for( i = 0; i < ImageInfo[currentImage]["Regions"].length; i++ )
    {
        el = {};
        el.path = ImageInfo[currentImage]["Regions"][i].path.exportJSON();
        el.name = ImageInfo[currentImage]["Regions"][i].name;
        obj.Regions.push(el);
    }
    localStorage.Microdraw = JSON.stringify(obj);

    if( debug ) console.log("+ saved regions:",ImageInfo[currentImage]["Regions"].length);
}

function getJsonSource() {
    return params.source.substr(1, params.source.length-5)+"_files/imageinfo.json";
}

function saveJson() {
    console.log("> writing json to file");

    // get rid of leading "/" and replace ".dzi" with "_files/imageinfo.json"
    var source = getJsonSource();
    console.log(source);

    $.ajax({
        type : "POST",
        url : "json.php",
        data : {
            json : JSON.stringify(ImageInfo[currentImage]["Regions"]),
            source: source
        }

    });

    console.log("< writing json to file");
}

function loadJson() {
    console.log("> loading json from " + getJsonSource());
    console.log(getJsonSource());
    $.getJSON(getJsonSource(), function(json) {
        var region;
        for(var i=0; i<json.length; i++) {
            region = json[i];
            if(json[i].counter > counter) {
                counter = json[i].counter;
            }
            if(json[i].point) {
                // create poi
                var path = new paper.Path();
                path.importJSON(json[i].path);
                path.remove();
                newRegion({point:new paper.Point(json[i].point[1], json[i].point[2]), path:path, context:json[i].context, name:json[i].name, uid:json[i].uid});
            } else {
                // create region
                var path = new paper.Path();
                path.importJSON(json[i].path);
                region.path = path;
                region.context = json[i].context;
                newRegion(region);
            }
        }
        updateRegionList();
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
       magicV = viewer.world.getItemAt(0).getContentSize().x / 100;

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

function deparam() {
    if( debug ) console.log("> deparam");

    var search = location.search.substring(1);
    var result = search?JSON.parse('{"' + search.replace(/&/g, '","').replace(/=/g,'":"') + '"}',
                     function(key, value) { return key===""?value:decodeURIComponent(value) }):{};
    if( debug ) console.log("url parametres:",result);

    return result;
}

function makeSVGInline() {
    if( debug ) console.log("> makeSVGInline promise");

    var def = $.Deferred();
    $('img.button').each(function() {
        var $img = $(this);
        var imgID = $img.attr('id');
        var imgClass = $img.attr('class');
        var imgURL = $img.attr('src');

        $.get(imgURL, function(data) {
            // Get the SVG tag, ignore the rest
            var $svg = $(data).find('svg');

            // Add replaced image's ID to the new SVG
            if( typeof imgID !== 'undefined' ) {
                $svg = $svg.attr('id', imgID);
            }
            // Add replaced image's classes to the new SVG
            if( typeof imgClass !== 'undefined' ) {
                $svg = $svg.attr('class', imgClass + ' replaced-svg');
            }

            // Remove any invalid XML tags as per http://validator.w3.org
            $svg = $svg.removeAttr('xmlns:a');

            // Replace image with new SVG
            $img.replaceWith($svg);

            if( debug ) console.log("< makeSVGInline resolve: success");
            def.resolve();
        }, 'xml');
    });

    return def.promise();
}

function updateSliceName() {
    var slash_index = params.source.lastIndexOf("/") + 1;
    var filename    = params.source.substr(slash_index);
    $("title").text(filename);
}

function initShortCutHandler() {
    $(document).keydown(function(e) {
        var key = [];
        if( e.ctrlKey ) key.push("^");
        if( e.altKey ) key.push("alt");
        if( e.shiftKey ) key.push("shift");
        if( e.metaKey ) key.push("cmd");
        key.push(String.fromCharCode(e.keyCode));
        key = key.join(" ");
        if( shortCuts[key] ) {
            var callback = shortCuts[key];
            callback();
            // e.preventDefault();
        }
    });
}

function shortCutHandler(key,callback) {
    var key = isMac?key.mac:key.pc;
    var arr = key.split(" ");
    for( var i = 0; i < arr.length; i++ ) {
        if( arr[i].charAt(0) == "#" ) {
            arr[i] = String.fromCharCode(parseInt(arr[i].substring(1)));
        } else
        if( arr[i].length == 1 ) {
            arr[i] = arr[i].toUpperCase();
        }
    }
    key = arr.join(" ");  
    shortCuts[key] = callback;
}

function loadConfiguration() {
    var def = $.Deferred();
    // load general microdraw configuration
    $.getJSON("configuration.json", function(data) {
        config = data;
        // load region dictionary
        $.getJSON(config.dictionary, function(dictionary) {
            regionDictionary = dictionary;
            appendRegionTagsFromDictionary();
        });
        
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

function loadMetaData() {
    // load image header file
    var headerFile = params.source.replace(".dzi", "_files/metadata.txt");
    // get information from header file
    var metadata = [];
    $.get(headerFile, function(txt){
        var lines = txt.split("\n");
        for(var i=0; i<lines.length; i++) {
            if(lines[i].indexOf(": ") > -1) {
                var line = lines[i].split(": ");
                metadata.push({"name":line[0], "value":line[1]});
            }
        }
        addScalebar(metadata);
        return metadata;
    });
}

function initMicrodraw() {

    if( debug ) console.log("> initMicrodraw promise");

    var def = $.Deferred();

    // Enable click on toolbar buttons
    $("img.button").click(toolSelection);
    
    // set annotation loading flag to false
    annotationLoadingFlag = false;
    
    // Initialize the control key handler and set shortcuts
    initShortCutHandler();
    shortCutHandler({pc:'^ z',mac:'cmd z'},cmdUndo);
    shortCutHandler({pc:'^ y',mac:'cmd y'},cmdRedo);
    if( config.drawingEnabled ) {
        shortCutHandler({pc:'^ x',mac:'cmd x'},function() { console.log("cut!")});
        shortCutHandler({pc:'^ v',mac:'cmd v'},cmdPaste);
        shortCutHandler({pc:'^ a',mac:'cmd a'},function() { console.log("select all!")});
        shortCutHandler({pc:'^ c',mac:'cmd c'},cmdCopy);
        shortCutHandler({pc:'#46',mac:'#8'},cmdDeleteSelected);  // delete key
    }

    // Configure currently selected tool
    selectedTool = "navigate";
    selectTool();

	// decide between json (local) and jsonp (cross-origin)
	var ext = params.source.split(".");
	
	ext = ext[ext.length - 1];
	if( ext == "dzi" ) {
		$.ajax({
			type: 'GET',
			url: params.source,
			dataType: "xml",
            contentType: "text/xml",
			success: function(obj){initMicrodrawXML(obj);def.resolve()},
		});
	}
	else {
		alert("WSI must be .dzi, can't read ." + ext);
	}
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
var mpp_x;
var mpp_y;
var objPower;
function addScalebar(metadata) {
    var orgWidth;
    for(var i=0; i<metadata.length; i++) {
        if(metadata[i].name == "openslide.mpp-x") {
            mpp_x = metadata[i].value;
        } else if(metadata[i].name == "openslide.mpp-y") {
            mpp_y = metadata[i].value;
        } else if(metadata[i].name == "openslide.objective-power") {
            objPower = metadata[i].value;
        } else if(metadata[i].name == "width") {
            orgWidth = metadata[i].value;
        }
    }

    var ppm = (objPower/(mpp_x * mpp_y)) * 100000;

    if(!isNaN(ppm)) {
        // add the scalebar
        viewer.scalebar({
            type: OpenSeadragon.ScalebarType.MICROSCOPE,
            minWidth:'150px',
            pixelsPerMeter:ppm,
            color:'black',
            fontColor:'black',
            backgroundColor:"rgba(255,255,255,0.5)",
            barThickness:4,
            location: OpenSeadragon.ScalebarLocation.TOP_RIGHT,
            xOffset:5,
            yOffset:5
        });
    }
}

function initMicrodrawXML(obj) {
	// set up the ImageInfo array and imageOrder array
    console.log(obj);

    currentImage = 0;
	ImageInfo[currentImage] = {"source": params.source, "Regions": [], "projectID": undefined, "metadata":loadMetaData()};


    // set default values for new regions (general configuration)
    if (config.defaultStrokeColor == undefined) config.defaultStrokeColor = 'black';
    if (config.defaultStrokeWidth == undefined) config.defaultStrokeWidth = 1;
    if (config.defaultFillAlpha == undefined) config.defaultFillAlpha = 0.5;
    // set default values for new regions (per-brain configuration)
    if (obj.configuration) {
        if (obj.configuration.defaultStrokeColor != undefined) config.defaultStrokeColor = obj.configuration.defaultStrokeColor;
        if (obj.configuration.defaultStrokeWidth != undefined) config.defaultStrokeWidth = obj.configuration.defaultStrokeWidth;
        if (obj.configuration.defaultFillAlpha != undefined) config.defaultFillAlpha = obj.configuration.defaultFillAlpha;
    }

	viewer = OpenSeadragon({
		id: "openseadragon1",
		prefixUrl: "lib/openseadragon/images/",
		showReferenceStrip: false,
		referenceStripSizeRatio: 0.2,
		showNavigator: true,
		sequenceMode: false,
		navigatorId:"myNavigator",
		homeButton:"home",
		preserveViewport: true,
		zoomPerClick: 1,
	});
	
	// open the currentImage
	viewer.open(ImageInfo[0]["source"]);

	// add handlers: update slice name, animation, page change, mouse actions
	viewer.addHandler('open',function(){
		initAnnotationOverlay();
		updateSliceName();

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

    // handle different zoom levels:
    viewer.addHandler('zoom', function(event){
        console.log("zoom: " + viewer.viewport.getZoom());
    });
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

$(function() {
    $.when(
        loadConfiguration()
    ).then(function(){
        params = deparam();
        initMicrodraw();
    });
});

// key listener
var tmpTool;
var ruler;

$(document).keydown(function(e) {
    if(e.keyCode == 9) {
        // tab
        e.preventDefault();
        selectNextRegion();
    } else if(e.keyCode == 16) {
        // shift
        selectToolOnKeyPress("addpoi");
    } else if(e.keyCode == 17) {
        // ctrl
        selectToolOnKeyPress("draw");
    } else if(e.keyCode == 18 || e.keyCode == 225) {
        // alt || alt gr
        selectToolOnKeyPress("select");
    } else if(e.keyCode == 27) {
        // esc
        clearToolSelection();
    } else if(e.keyCode == 68) {
        // ctrl + d
        if(e.ctrlKey) {
            e.preventDefault();
            selectedTool = selectedTool == "draw" ? "draw-polygon" : "draw";
            selectTool();
        }
    } else if(e.keyCode == 81) {
        // ctrl + q
        if(e.ctrlKey) {
            selectedTool = selectedTool == "distance" ? "draw" : "distance";
            selectTool();
            navEnabled = false;
        }
    } else if(e.keyCode == 83) {
        // ctrl + s
        if(e.ctrlKey) {
            e.preventDefault();
            saveJson();
        }
    }
});

function selectToolOnKeyPress(id) {
    tmpTool = selectedTool;
    selectedTool = id;
    navEnabled = false;
    selectTool();
}

$(document).keyup(function(e) {
    var element = document.getElementById("distance-tooltip");
    if(element) {
        element.parentNode.removeChild(element);
    }
    if(e.keyCode == 16 || e.keyCode == 17 || e.keyCode == 18 || e.keyCode == 225) {
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