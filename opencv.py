#!/usr/bin/env python

from cv2.cv import *
import sys
import cv2
import numpy as np

# /home/sawn/Studium/Master/microservices/AnnotationService/opencv.py
# dzi/TCGA_files/18/286_74.jpeg 36 152

debug = 0

if(debug):
    img = cv2.imread("dzi/66063_files/17/108_49.jpeg")
    x = 20
    y = 20
else:
    img = cv2.imread(sys.argv[1])
    img2 = cv2.imread(sys.argv[1])
    origX = float(sys.argv[2]);
    origY = float(sys.argv[3]);
    x = int(origX) % 256
    y = int(origY) % 256
# cv2.line(img,(x,y-10), (x,y+10), (0,0,0), 2)
# cv2.line(img,(x-10,y), (x+10,y), (0,0,0), 2)
gray_image = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


sigma = 0.33
v = np.median(img)
blur = cv2.GaussianBlur(gray_image,(3,3),0)
# apply automatic Canny edge detection using the computed median
lower = int(max(0, (1.0 - sigma) * v))
upper = int(min(255, (1.0 + sigma) * v))
edged = cv2.Canny(blur, lower, upper)

contours, hierarchy = cv2.findContours(edged,cv2.RETR_TREE,cv2.CHAIN_APPROX_SIMPLE)
hulls = []

for contour in contours:
    hull = cv2.convexHull(contour)
    hulls.append(hull)

    # Otsu's thresholding after Gaussian filtering
# blur = cv2.GaussianBlur(gray_image,(5,5),0)
# ret,binary_img = cv2.threshold(blur,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
# contours, hierarchy = cv2.findContours(binary_img,cv2.RETR_TREE,cv2.CHAIN_APPROX_SIMPLE)


for index in range(0, len(contours)):
    # inside = cv2.pointPolygonTest(contours[index], (x,y), 0)
    # if(/inside >= 0):
    cv2.drawContours(img, contours, index, (0,255,0), 1)

cv2.imshow('image',img)
cv2.waitKey(0)
cv2.destroyAllWindows()


