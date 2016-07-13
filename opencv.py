#!/usr/bin/env python

from cv2.cv import *
import sys

img = LoadImage(sys.argv[1])
NamedWindow("opencv")
ShowImage("opencv", img)
WaitKey(0)
