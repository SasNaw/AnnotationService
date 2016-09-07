#!/usr/bin/env python
#
# This library is free software; you can redistribute it and/or modify it
# under the terms of version 2.1 of the GNU Lesser General Public License
# as published by the Free Software Foundation.

from flask import Flask, abort, make_response, render_template, url_for, request, jsonify
from io import BytesIO
import openslide
from openslide import ImageSlide, open_slide
from openslide.deepzoom import DeepZoomGenerator
from optparse import OptionParser
import re
from unicodedata import normalize
import os.path
import json

DEEPZOOM_SLIDE = None
DEEPZOOM_FORMAT = 'jpeg'
DEEPZOOM_TILE_SIZE = 256
DEEPZOOM_OVERLAP = 0
DEEPZOOM_LIMIT_BOUNDS = True
DEEPZOOM_TILE_QUALITY = 100
SLIDE_NAME = 'slide'
SLIDE_DICTIONARIES = 'static/slideDictionaries.json'
global DEFAULT_DICTIONARY

app = Flask(__name__)
app.config.from_object(__name__)
app.config.from_envvar('DEEPZOOM_TILER_SETTINGS', silent=True)

class PILBytesIO(BytesIO):
    def fileno(self):
        '''Classic PIL doesn't understand io.UnsupportedOperation.'''
        raise AttributeError('Not supported')


def getDictionary(file_path):
    with open(SLIDE_DICTIONARIES, 'r') as file:
        dictioary_map = json.loads(file.read())
    dictionary = dictioary_map.get(file_path)
    if dictionary:
        return dictionary
    else:
        dictioary_map[file_path] = DEFAULT_DICTIONARY
        with open(SLIDE_DICTIONARIES, 'w') as file:
            file.write(json.dumps(dictioary_map))
        return DEFAULT_DICTIONARY


@app.route('/wsi/<path:file_path>.dzi')
def index_dzi(file_path):
    file_name = file_path + '.dzi'
    slide_url = '/wsi/' + file_name
    # read dzi file
    try:
        with open('static/wsi/' + file_path + '_files/metadata.txt') as file:
            mpp_x = 0
            mpp_y = 0
            metadata = file.read().split('\n')
            for property in metadata:
                if openslide.PROPERTY_NAME_MPP_X in property:
                    mpp_x = property.split(': ')[1]
                elif openslide.PROPERTY_NAME_MPP_Y in property:
                    mpp_y = property.split(': ')[1]
            slide_mpp = (float(mpp_x) + float(mpp_y)) / 2
    except IOError:
        slide_mpp = 0
    return render_template('as_viewer.html', slide_url=slide_url, slide_mpp=slide_mpp, file_name=file_name, dictionary=getDictionary(file_name))


@app.route('/wsi/<path:file_path>')
def index_wsi(file_path):
    config_map = {
        'DEEPZOOM_TILE_SIZE': 'tile_size',
        'DEEPZOOM_OVERLAP': 'overlap',
        'DEEPZOOM_LIMIT_BOUNDS': 'limit_bounds',
    }
    opts = dict((v, app.config[k]) for k, v in config_map.items())
    slide = open_slide('static/wsi/' + file_path)
    app.slides = {
        SLIDE_NAME: DeepZoomGenerator(slide, **opts)
    }
    app.associated_images = []
    app.slide_properties = slide.properties
    for name, image in slide.associated_images.items():
        app.associated_images.append(name)
        slug = slugify(name)
        app.slides[slug] = DeepZoomGenerator(ImageSlide(image), **opts)
    try:
        mpp_x = slide.properties[openslide.PROPERTY_NAME_MPP_X]
        mpp_y = slide.properties[openslide.PROPERTY_NAME_MPP_Y]
        slide_mpp = (float(mpp_x) + float(mpp_y)) / 2
    except (KeyError, ValueError):
        slide_mpp = 0
    slide_url = url_for('dzi', slug=SLIDE_NAME)
    return render_template('as_viewer.html', slide_url=slide_url, slide_mpp=slide_mpp, file_name=file_path, dictionary=getDictionary(file_path))


@app.route('/<slug>.dzi')
def dzi(slug):
    format = app.config['DEEPZOOM_FORMAT']
    try:
        resp = make_response(app.slides[slug].get_dzi(format))
        resp.mimetype = 'application/xml'
        return resp
    except KeyError:
        # Unknown slug
        abort(404)


@app.route('/<slug>_files/<int:level>/<int:col>_<int:row>.<format>')
def tile(slug, level, col, row, format):
    format = format.lower()
    if format != 'jpeg' and format != 'png':
        # Not supported by Deep Zoom
        abort(404)
    try:
        tile = app.slides[slug].get_tile(level, (col, row))
    except KeyError:
        # Unknown slug
        abort(404)
    except ValueError:
        # Invalid level or coordinates
        abort(404)
    buf = PILBytesIO()
    tile.save(buf, format, quality=app.config['DEEPZOOM_TILE_QUALITY'])
    resp = make_response(buf.getvalue())
    resp.mimetype = 'image/%s' % format
    return resp


def slugify(text):
    text = normalize('NFKD', text.lower()).encode('ascii', 'ignore').decode()
    return re.sub('[^a-z0-9]+', '-', text)


@app.route('/saveJson', methods=['POST'])
def saveJson():
    dict = request.form
    source = dict.get('source', default='')
    json = dict.get('json', default='{}').encode('utf-8')
    if len(source) > 0:
        with open('static/' + source, 'w+') as file:
            file.write(json)
    return 'Ok'


@app.route('/loadJson')
def loadJson():
    source = 'static/wsi/' + request.args.get('src', '')
    if os.path.isfile(source):
        with open(source, 'r') as file:
            content = file.read()
            return jsonify(content)
    else:
        return jsonify('[]')\


@app.route('/createDictionary')
def createDictionary():
    name = request.args.get('name', '')
    slide = request.args.get('slide')
    path = 'static/dictionaries/' + name
    if os.path.isfile(path):
        # dictionary already exists
        return 'error'
    else:
        with open(path, 'w+') as dictionary:
            dictionary.write("[]")

    with open(SLIDE_DICTIONARIES, 'r') as file:
        dictioary_map = json.loads(file.read())
    dictioary_map[slide] = name
    with open(SLIDE_DICTIONARIES, 'w') as file:
        file.write(json.dumps(dictioary_map))

    respone = '{"name":"' + name + '", "path":"/' + path + '"}';
    return respone


@app.route('/static/dictionaries/<dictionary>')
def loadDictionary(dictionary):
    dictionary = 'static/dictionaries/' + dictionary
    if os.path.isfile('/' + dictionary):
        # no dictionary found
        return '404'
    else:
        # return dictionary
        with open(dictionary, 'r') as file:
            return json.dumps(file.read())


@app.route('/getDictionaries')
def getDictionaries():
    dir = 'static/dictionaries/'
    if os.path.isfile(dir):
        # no dictionaries found
        return '-1'
    else:
        # return dictionaries
        return json.dumps(os.listdir(dir))


@app.route('/switchDictionary')
def switchDictionary():
    name = request.args.get('name', '')
    slide = request.args.get('slide')

    with open(SLIDE_DICTIONARIES, 'r') as file:
        dictioary_map = json.loads(file.read())
    dictioary_map[slide] = name
    with open(SLIDE_DICTIONARIES, 'w') as file:
        file.write(json.dumps(dictioary_map))

    return '200'

# to use your own segmentation script, place the python file in "static/segmentation" and change the script name
# in configuration.json (key: "segmentationScript"). Make sure, your script provides a "run(x,y)" function.
# as_server will call the run function of your script and pass the x- and y-coordinate to it as function
# parameters.
# Your script must return a list of 2d coordinates. This list will be returned to the viewer as json. The viewer will
# create a new region with the provided coordinates.
@app.route("/runSegmentation")
def runSegmentation():
    x = request.args.get('x', '0')
    y = request.args.get('y', '0')
    with open("static/configuration.json", 'r') as file:
        config = json.loads(file.read())
        module_name = config.get("segmentationScript")
    if(len(module_name) == 0):
        print("ERROR: no segmentation script provided in configuration file (configuration.json)!")
        return "404"
    try:
        module = __import__("static.segmentation.%s" % (module_name), fromlist=["segmentation"])
        contour = module.run(x,y)
        return json.dumps(contour)
    except ImportError:
        print("ERROR: provided segmentation script (" + module_name + ") not found!")
        return "404"


if __name__ == '__main__':
    parser = OptionParser(usage='Usage: %prog [options] [slide]')
    parser.add_option('-B', '--ignore-bounds', dest='DEEPZOOM_LIMIT_BOUNDS',
                default=True, action='store_false',
                help='display entire scan area')
    parser.add_option('-c', '--config', metavar='FILE', dest='config',
                help='config file')
    parser.add_option('-d', '--debug', dest='DEBUG', action='store_true',
                help='run in debugging mode (insecure)')
    parser.add_option('-e', '--overlap', metavar='PIXELS',
                dest='DEEPZOOM_OVERLAP', type='int',
                help='overlap of adjacent tiles [1]')
    parser.add_option('-f', '--format', metavar='{jpeg|png}',
                dest='DEEPZOOM_FORMAT',
                help='image format for tiles [jpeg]')
    parser.add_option('-l', '--listen', metavar='ADDRESS', dest='host',
                default='127.0.0.1',
                help='address to listen on [127.0.0.1]')
    parser.add_option('-p', '--port', metavar='PORT', dest='port',
                type='int', default=5000,
                help='port to listen on [5000]')
    parser.add_option('-Q', '--quality', metavar='QUALITY',
                dest='DEEPZOOM_TILE_QUALITY', type='int',
                help='JPEG compression quality [75]')
    parser.add_option('-s', '--size', metavar='PIXELS',
                dest='DEEPZOOM_TILE_SIZE', type='int',
                help='tile size [256]')

    (opts, args) = parser.parse_args()
    # Load config file if specified
    if opts.config is not None:
        app.config.from_pyfile(opts.config)
    # Overwrite only those settings specified on the command line
    for k in dir(opts):
        if not k.startswith('_') and getattr(opts, k) is None:
            delattr(opts, k)
    app.config.from_object(opts)

    if not os.path.isfile(SLIDE_DICTIONARIES):
        with open(SLIDE_DICTIONARIES, 'w') as file:
            file.write('{}')

    with open('static/configuration.json', 'r') as config:
        DEFAULT_DICTIONARY = json.loads(config.read()).get('dictionary')

    app.run(host=opts.host, port=opts.port, threaded=True)
