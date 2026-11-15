[out:json][timeout:90];
(
 node["place"~"town|village|hamlet"](51.14,-1.88,51.22,-1.74);
 nwr["amenity"="place_of_worship"](51.16,-1.80,51.19,-1.76);
 nwr["name"~"Amesbury Abbey|Abbey",i](51.16,-1.80,51.19,-1.76);
 nwr["historic"~"abbey|monastery|church"](51.16,-1.80,51.19,-1.76);
 nwr["landuse"="religious"](51.16,-1.80,51.19,-1.76);
);
out geom tags;
