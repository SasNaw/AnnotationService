# AnnotationService
AnnotationService is a web application which is intended to make annotations on whole slide images (WSI). With it, you can:
* view all WSI formats supported by [OpenSlide](http://openslide.org/), as well as deep zoom images [(DZI)](https://msdn.microsoft.com/en-us/library/cc645077(v=vs.95).aspx)
* create dictionaries and add labels to use for later annotations
* draw annotated regions, either in freehand mode or as a polygon
* save and load annotations
* measure distances
* use a custom python script for segmentation of special points of interest

## Installation
    git clone https://github.com/SasNaw/AnnotationService.git

## Dependencies
- Python installation of [OpenSlide](http://openslide.org/download/)
- [Flask](http://flask.pocoo.org/)

## Before use
To use AnnotationService, some requirements must be met:
* a local web server must be started
* you need valid input WSIs 
* those WSIs must be in a specific directory
* if you want to use a custom python script for automatic segmentation of points of interest, it also must be in a specific folder 

To start a local web server, go to the cloned directory and start the deepzoom_server.py script. A local web server will run on 127.0.0.1:5000. If this port is already in use you can specify a custom port via the -p [port] parameter.

Put your WSI files into [cloned directory]/static/wsi/; from there on, you can create any sub directory structure you want.

If you want to use a custom python script for automated segmentation, place it in [cloned directory]/static/segmentation/. After that, open the configuration.json in [cloned directory]/static/ with a text editor of your choice and set the value of "segmentationScript" to the name of your custom script. If you want to create a sub folder structure for your custom scripts, also specify the path to the script from the segmentation/ directory, do not include the basic path ([cloned directory]/static/segmentation/) though!


## How to use:
Open a web browser of your choice and browse to 127.0.0.1:5000/wsi/[[sub path to WSI/]name of WSI]. The specified WSI will be loaded and viewed in AnnoationService. When started first, an examplary dictionary will be loaded. A new dictionary can be created over the shortcut shift + ctrl + "+". New entries can be added via ctrl + "+". Existing dictionaries can be switched WITH a click on the "Dictionary" section.

The mouse and arrow keys can be used to navigate over the WSI. For other actions, short cuts and hot keys are used:
- ctrl (hold)  + left mouse (hold) = freehand drawing mode
- ctrl (hold)  + d (tap) = switch between freehand and polygon drawing mode
- ctrl (hold)  + q (tap) = switch between freehand drawing and distance measuring mode
- shift (hold) + left mouse (hold) = place point of interest
- alt (hold) + left mouse (click) = select region
- ctrl + s = save annotations
- tab = iterate through labels
- del = delete selected region
- esc = deselect a selected region
