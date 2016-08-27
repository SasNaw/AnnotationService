#!/usr/bin/env python

def run(x,y):
    x = float(x)
    y = float(y)
    contour = []
    contour.append((x-1000,y-1000))
    contour.append((x+1000,y-1000))
    contour.append((x+1000,y+1000))
    contour.append((x-1000,y+1000))

    return contour

