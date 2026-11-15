import math,json
O_LAT,O_LON=51.17886,-1.82621
def loc(lat,lon):
    return ((lon-O_LON)*111320*math.cos(math.radians(O_LAT)), -(lat-O_LAT)*111250)
def ll(x,z):
    return (O_LAT - z/111250, O_LON + x/(111320*math.cos(math.radians(O_LAT))))
def pos(e):
    return (e['lat'],e['lon']) if e['type']=='node' else (e['center']['lat'],e['center']['lon'])
