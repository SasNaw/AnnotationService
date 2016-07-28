#!/usr/bin/env python
#
# deepzoom_server - Example web application for serving whole-slide images
#
# Copyright (c) 2010-2015 Carnegie Mellon University
#
# This library is free software; you can redistribute it and/or modify it
# under the terms of version 2.1 of the GNU Lesser General Public License
# as published by the Free Software Foundation.
#
# This library is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
# or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Lesser General Public
# License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with this library; if not, write to the Free Software Foundation,
# Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
#

from flask import Flask, abort, make_response, render_template, url_for, request, jsonify
from io import BytesIO
import openslide
from openslide import ImageSlide, open_slide
from openslide.deepzoom import DeepZoomGenerator
from optparse import OptionParser
import re
from unicodedata import normalize
import os.path

DEEPZOOM_SLIDE = None
DEEPZOOM_FORMAT = 'jpeg'
DEEPZOOM_TILE_SIZE = 256
DEEPZOOM_OVERLAP = 0
DEEPZOOM_LIMIT_BOUNDS = True
DEEPZOOM_TILE_QUALITY = 100
SLIDE_NAME = 'slide'

app = Flask(__name__)
app.config.from_object(__name__)
app.config.from_envvar('DEEPZOOM_TILER_SETTINGS', silent=True)


class PILBytesIO(BytesIO):
    def fileno(self):
        '''Classic PIL doesn't understand io.UnsupportedOperation.'''
        raise AttributeError('Not supported')


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
    return render_template('index.html', slide_url=slide_url, slide_mpp=slide_mpp, file_name=file_name)


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
    return render_template('index.html', slide_url=slide_url, slide_mpp=slide_mpp, file_name=file_path)


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
    json = dict.get('json', default='{}')
    if len(source) > 0 and len(json) > 2:
        # only create and fill a file if there is something to fill it with
        with open('static/wsi/' + source, 'w+') as file:
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
        return jsonify('[]')



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

    app.run(host=opts.host, port=opts.port, threaded=True)
