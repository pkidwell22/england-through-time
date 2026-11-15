"""
What is built: the bodies (MPFB macro settings) and, per period, the garments each body wears and the outfits
(combinations of optional garments) instances choose from.

Costume notes (kept generic; see docs/FIGURES.md for every judgement call):
  prehistoric  c. 4000 BCE - 800 BCE  wool or hide tunics and wraps, cloaks, leggings; hair visible
  roman        c. 800 BCE - 450 CE    tunic, cloak (sagum / paenula-like), trousers for men; long tunic and mantle for
                                      women; no togas (the populace code does not distinguish citizens)
  saxon        c. 450 - 1066          knee tunic with belt, hose and leg wraps, cloak; women in long gown and veil
  medieval     c. 1066 - 1485         cote and hose, hood with shoulder cape or coif; kirtle with veil and wimple or coif
  tudor        c. 1485 - 1625         doublet, breeches and hose, flat cap or hat, long gown (older men); kirtle/gown,
                                      coif, hat over coif, apron; ruffs on a minority
  barnet1471   soldiers at Barnet     padded jack in the side's tint, hose, sallet (most) or hood
  brentford1016 soldiers at Brentford knee tunic in the side's tint, trousers and leg wraps, rounded helmet (a minority)
"""
import garments as G
from garments import MAIN, SECOND, OUTER, HEADW, LINEN, LEATHER, HAIR, METAL, WRAP

# type: the populace body type each variant serves (0 man, 1 woman, 2 tall and lean, 3 stout, 4 child, 5 elder)
BODIES = [
    dict(id="man_a", type=0, sex="m", gender=1.0, age=0.5, muscle=0.5, weight=0.5, height=0.45),
    dict(id="man_b", type=0, sex="m", gender=1.0, age=0.45, muscle=0.62, weight=0.38, height=0.5, race={"caucasian": 0.8, "african": 0.1, "asian": 0.1}),
    dict(id="man_c", type=0, sex="m", gender=1.0, age=0.6, muscle=0.62, weight=0.62, height=0.36, race={"caucasian": 0.85, "african": 0.05, "asian": 0.1}),
    dict(id="woman_a", type=1, sex="f", gender=0.0, age=0.5, muscle=0.45, weight=0.5, height=0.45),
    dict(id="woman_b", type=1, sex="f", gender=0.0, age=0.4, muscle=0.5, weight=0.38, height=0.56, race={"caucasian": 0.8, "african": 0.12, "asian": 0.08}),
    dict(id="woman_c", type=1, sex="f", gender=0.0, age=0.62, muscle=0.4, weight=0.66, height=0.4),
    dict(id="tall", type=2, sex="m", gender=1.0, age=0.5, muscle=0.55, weight=0.38, height=0.55),
    dict(id="stout_m", type=3, sex="m", gender=1.0, age=0.66, muscle=0.45, weight=0.86, height=0.45),
    dict(id="stout_f", type=3, sex="f", gender=0.0, age=0.68, muscle=0.35, weight=0.84, height=0.4),
    dict(id="boy", type=4, sex="m", child=True, gender=1.0, age=0.17, muscle=0.5, weight=0.45, height=0.5),
    dict(id="girl", type=4, sex="f", child=True, gender=0.0, age=0.17, muscle=0.5, weight=0.45, height=0.5),
    dict(id="old_m", type=5, sex="m", elder=True, gender=1.0, age=0.88, muscle=0.35, weight=0.45, height=0.4),
    dict(id="old_f", type=5, sex="f", elder=True, gender=0.0, age=0.9, muscle=0.3, weight=0.5, height=0.35),
]

SOLDIER_BODIES = ["man_a", "man_b", "man_c", "tall", "stout_m"]

# periods: [first year, last year) in historical years
PERIODS = [
    ("prehistoric", -10000, -800),
    ("roman", -800, 450),
    ("saxon", 450, 1066),
    ("medieval", 1066, 1485),
    ("tudor", 1485, 10000),
]


def O(name, w_tunic, w_gown, parts):
    return dict(name=name, w=[w_tunic, w_gown], parts=parts)


# ------------------------------------------------------------------------------------- outfits

def common(B, P, hair=True, beard=None):
    P["shoes"] = G.shoes(B)
    if hair:
        P["hair"] = G.hair_short(B)
    if beard:
        P["beard"] = G.beard(B)


def prehistoric(B):
    s, k = B.spec, B.k
    P = {}
    common(B, P, beard=(s["sex"] == "m" and not s.get("child")))
    if s["sex"] == "m":
        P["tunic"] = G.torso_shell(B, "tunic", MAIN, neck_drop=0.05, bottom_z=B.z_hip - 0.02 * k, sleeve=0.32, clearance=0.014)
        P["skirt"] = G.skirt_loft(B, "tunicskirt", MAIN, B.z_hip + 0.0 * k, B.z_knee + 0.04 * k, ease_top=0.025, ease_hem=0.035, flare=0.12, seed=11)
        P["legs"] = G.leg_shell(B, "leggings", SECOND, B.z_hip, B.z_ankle + 0.015 * k, clearance=0.006)
        P["belt"] = G.band_over(B, P["tunic"], B.z_hip + 0.06 * k, ease=0.007)
        P["cloak"] = G.cloak(B, "cloak", OUTER, B.z_knee - 0.02 * k, seed=12)
        outfits = [O("tunic", 0.55, 0.2, ["tunic", "skirt", "legs", "belt", "hair"]),
                   O("tunic-cloak", 0.25, 0.6, ["tunic", "skirt", "legs", "belt", "hair", "cloak"]),
                   O("tunic-beard", 0.2, 0.0, ["tunic", "skirt", "legs", "belt", "hair", "beard"]),
                   O("tunic-cloak-beard", 0.0, 0.2, ["tunic", "skirt", "legs", "belt", "hair", "beard", "cloak"])]
    else:
        P["tunic"] = G.torso_shell(B, "tunic", MAIN, neck_drop=0.04, bottom_z=B.z_hip, sleeve=0.4, clearance=0.012)
        P["skirt"] = G.skirt_loft(B, "skirt", MAIN, B.z_hip + 0.02 * k, B.z_ankle + 0.03 * k, ease_top=0.025, ease_hem=0.04, flare=0.1, seed=13)
        P["belt"] = G.band_over(B, P["tunic"], B.z_hip + 0.08 * k, ease=0.007, slot=WRAP)
        P["tail"] = G.hair_tail(B, length=0.2)
        P["cloak"] = G.cloak(B, "cloak", OUTER, B.z_knee - 0.05 * k, seed=14)
        outfits = [O("dress", 0.6, 0.6, ["tunic", "skirt", "belt", "hair", "tail"]),
                   O("dress-cloak", 0.4, 0.4, ["tunic", "skirt", "belt", "hair", "tail", "cloak"])]
    return P, outfits


def roman(B):
    s, k = B.spec, B.k
    P = {}
    common(B, P, beard=(s["sex"] == "m" and not s.get("child")))
    if s["sex"] == "m":
        P["tunic"] = G.torso_shell(B, "tunic", MAIN, neck_drop=0.05, bottom_z=B.z_hip - 0.02 * k, sleeve=0.3, clearance=0.013)
        P["skirt"] = G.skirt_loft(B, "tunicskirt", MAIN, B.z_hip, B.z_knee + 0.02 * k, ease_top=0.025, ease_hem=0.035, flare=0.12, seed=21)
        P["legs"] = G.leg_shell(B, "trousers", SECOND, B.z_hip, B.z_ankle + 0.015 * k, clearance=0.008)
        P["belt"] = G.band_over(B, P["tunic"], B.z_hip + 0.07 * k, ease=0.007)
        P["cloak"] = G.cloak(B, "cloak", OUTER, B.z_knee + 0.06 * k, half_top=2.7, half_hem=2.2, seed=22)
        P["longskirt"] = G.skirt_loft(B, "longtunic", MAIN, B.z_hip, B.z_ankle + 0.05 * k, ease_top=0.03, ease_hem=0.045, flare=0.12, seed=23, layer=4)
        outfits = [O("tunic", 0.45, 0.0, ["tunic", "skirt", "legs", "belt", "hair"]),
                   O("tunic-beard", 0.2, 0.0, ["tunic", "skirt", "legs", "belt", "hair", "beard"]),
                   O("tunic-cloak", 0.35, 0.3, ["tunic", "skirt", "legs", "belt", "hair", "cloak"]),
                   O("longtunic-cloak", 0.0, 0.4, ["tunic", "longskirt", "belt", "hair", "cloak"]),
                   O("longtunic", 0.0, 0.3, ["tunic", "longskirt", "belt", "hair", "beard"])]
    else:
        P["tunic"] = G.torso_shell(B, "tunic", MAIN, neck_drop=0.045, bottom_z=B.z_hip, sleeve=0.55, clearance=0.012)
        P["skirt"] = G.skirt_loft(B, "skirt", MAIN, B.z_hip + 0.02 * k, B.z_ankle - 0.01 * k, ease_top=0.025, ease_hem=0.05, flare=0.11, seed=24)
        P["belt"] = G.band_over(B, P["tunic"], B.z_waist + 0.04 * k, ease=0.007, slot=WRAP)
        P["tail"] = G.hair_tail(B, length=0.08, r=0.035)
        P["mantle"] = G.cloak(B, "mantle", OUTER, B.z_knee - 0.02 * k, half_top=2.6, half_hem=2.1, seed=25)
        P["veil"] = G.hood_head(B, clearance=0.016, slot=OUTER, layer=6)
        P["veild"] = G.veil_drape(B, slot=OUTER, half=1.35)
        outfits = [O("tunic", 0.4, 0.4, ["tunic", "skirt", "belt", "hair", "tail"]),
                   O("tunic-mantle", 0.3, 0.3, ["tunic", "skirt", "belt", "hair", "tail", "mantle"]),
                   O("tunic-mantle-head", 0.3, 0.3, ["tunic", "skirt", "belt", "veil", "veild", "mantle"])]
    return P, outfits


def saxon(B):
    s, k = B.spec, B.k
    P = {}
    common(B, P, beard=(s["sex"] == "m" and not s.get("child")))
    if s["sex"] == "m":
        P["tunic"] = G.torso_shell(B, "tunic", MAIN, neck_drop=0.04, bottom_z=B.z_hip - 0.02 * k, sleeve=0.97, clearance=0.013)
        P["skirt"] = G.skirt_loft(B, "tunicskirt", MAIN, B.z_hip, B.z_knee + 0.03 * k, ease_top=0.025, ease_hem=0.035, flare=0.13, seed=31)
        P["legs"] = G.leg_shell(B, "hose", SECOND, B.z_hip, B.z_knee - 0.02 * k, clearance=0.007)
        P["wraps"] = G.leg_shell(B, "wraps", WRAP, B.z_knee - 0.0 * k, B.z_ankle + 0.015 * k, clearance=0.011, smooth=2)
        P["belt"] = G.band_over(B, P["tunic"], B.z_hip + 0.07 * k, ease=0.007)
        P["cloak"] = G.cloak(B, "cloak", OUTER, B.z_knee + 0.02 * k, seed=32)
        P["cap"] = G.soft_cap(B)
        outfits = [O("tunic", 0.3, 0.1, ["tunic", "skirt", "legs", "wraps", "belt", "hair"]),
                   O("tunic-beard", 0.3, 0.1, ["tunic", "skirt", "legs", "wraps", "belt", "hair", "beard"]),
                   O("tunic-cloak", 0.2, 0.5, ["tunic", "skirt", "legs", "wraps", "belt", "hair", "beard", "cloak"]),
                   O("tunic-cap", 0.2, 0.3, ["tunic", "skirt", "legs", "wraps", "belt", "hair", "cap"])]
    else:
        P["tunic"] = G.torso_shell(B, "gown", MAIN, neck_drop=0.035, bottom_z=B.z_hip, sleeve=0.97, clearance=0.012)
        P["skirt"] = G.skirt_loft(B, "gownskirt", MAIN, B.z_hip + 0.02 * k, B.z_ankle - 0.015 * k, ease_top=0.025, ease_hem=0.05, flare=0.11, seed=33)
        P["belt"] = G.band_over(B, P["tunic"], B.z_waist + 0.03 * k, ease=0.007, slot=WRAP)
        P["veil"] = G.hood_head(B, clearance=0.015, slot=HEADW, layer=6)
        P["veild"] = G.veil_drape(B, slot=HEADW, half=1.35)
        P["cloak"] = G.cloak(B, "cloak", OUTER, B.z_knee - 0.03 * k, seed=34)
        P["tail"] = G.hair_tail(B, length=0.28, r=0.026)
        if s.get("child"):
            outfits = [O("gown", 0.7, 0.7, ["tunic", "skirt", "belt", "hair", "tail"]),
                       O("gown-cloak", 0.3, 0.3, ["tunic", "skirt", "belt", "hair", "tail", "cloak"])]
        else:
            outfits = [O("gown-veil", 0.6, 0.6, ["tunic", "skirt", "belt", "veil", "veild"]),
                       O("gown-veil-cloak", 0.3, 0.3, ["tunic", "skirt", "belt", "veil", "veild", "cloak"]),
                       O("gown-hair", 0.1, 0.1, ["tunic", "skirt", "belt", "hair", "tail"])]
    return P, outfits


def medieval(B):
    s, k = B.spec, B.k
    P = {}
    common(B, P, beard=(s["sex"] == "m" and not s.get("child")))
    if s["sex"] == "m":
        P["cote"] = G.torso_shell(B, "cote", MAIN, neck_drop=0.035, bottom_z=B.z_hip - 0.02 * k, sleeve=0.98, clearance=0.012)
        P["skirt"] = G.skirt_loft(B, "coteskirt", MAIN, B.z_hip, B.z_knee - 0.02 * k, ease_top=0.025, ease_hem=0.04, flare=0.14, seed=41)
        P["longskirt"] = G.skirt_loft(B, "longcote", MAIN, B.z_hip, B.z_ankle + 0.06 * k, ease_top=0.028, ease_hem=0.05, flare=0.14, seed=42, layer=4)
        P["legs"] = G.leg_shell(B, "hose", SECOND, B.z_hip, B.z_ankle + 0.015 * k, clearance=0.006)
        P["belt"] = G.band_over(B, P["cote"], B.z_hip + 0.05 * k, ease=0.007)
        P["hood"] = G.hood_head(B, clearance=0.02, slot=HEADW, layer=6)
        P["cape"] = G.skirt_loft(B, "hoodcape", HEADW, B.z_neck - 0.025 * k, B.z_shoulder - 0.2 * k, ease_top=0.012, ease_hem=0.03, flare=0.12, folds=0.02,
                                 which=("torso", "arm", "head"), legmix=0.0, layer=7, seed=43, step=0.03)
        P["coif"] = G.coif(B)
        outfits = [O("cote", 0.3, 0.0, ["cote", "skirt", "legs", "belt", "hair"]),
                   O("cote-hood", 0.35, 0.0, ["cote", "skirt", "legs", "belt", "hair", "hood", "cape"]),
                   O("cote-coif", 0.15, 0.0, ["cote", "skirt", "legs", "belt", "coif"]),
                   O("cote-beard", 0.2, 0.0, ["cote", "skirt", "legs", "belt", "hair", "beard"]),
                   O("long-hood", 0.0, 0.55, ["cote", "longskirt", "legs", "belt", "hair", "hood", "cape"]),
                   O("long", 0.0, 0.45, ["cote", "longskirt", "legs", "belt", "hair", "beard"])]
    else:
        P["kirtle"] = G.torso_shell(B, "kirtle", MAIN, neck_drop=0.04, bottom_z=B.z_waist - 0.02 * k, sleeve=0.98, clearance=0.009)
        P["skirt"] = G.skirt_loft(B, "kirtleskirt", MAIN, B.z_waist, 0.015, ease_top=0.018, ease_hem=0.04, flare=0.1, seed=44)
        P["belt"] = G.band_over(B, P["kirtle"], B.z_waist + 0.005, ease=0.007, half=0.012)
        P["veil"] = G.hood_head(B, clearance=0.016, slot=LINEN, layer=6)
        P["veild"] = G.veil_drape(B, slot=LINEN, half=1.35)
        P["wimple"] = G.wimple(B)
        P["coif"] = G.coif(B)
        P["apron"] = G.apron(B, P["skirt"], B.z_waist - 0.03 * k, B.z_knee - 0.2 * k)
        P["tail"] = G.hair_tail(B, length=0.32, r=0.024)
        if s.get("child"):
            outfits = [O("kirtle-hair", 0.6, 0.6, ["kirtle", "skirt", "belt", "hair", "tail"]),
                       O("kirtle-coif", 0.4, 0.4, ["kirtle", "skirt", "belt", "coif"])]
        else:
            outfits = [O("kirtle-veil-wimple", 0.35, 0.35, ["kirtle", "skirt", "belt", "veil", "veild", "wimple"]),
                       O("kirtle-veil", 0.25, 0.25, ["kirtle", "skirt", "belt", "veil", "veild"]),
                       O("kirtle-coif-apron", 0.25, 0.25, ["kirtle", "skirt", "belt", "coif", "apron"]),
                       O("kirtle-veil-apron", 0.15, 0.15, ["kirtle", "skirt", "belt", "veil", "veild", "apron"])]
    return P, outfits


def tudor(B):
    s, k = B.spec, B.k
    P = {}
    common(B, P, beard=(s["sex"] == "m" and not s.get("child")))
    if s["sex"] == "m":
        P["doublet"] = G.torso_shell(B, "doublet", MAIN, neck_drop=0.0, bottom_z=B.z_waist - 0.04 * k, sleeve=0.99, clearance=0.012, smooth=4, collar=0.01)
        P["tabs"] = G.skirt_loft(B, "doublettabs", MAIN, B.z_waist - 0.02 * k, B.z_waist - 0.12 * k, ease_top=0.006, ease_hem=0.016, flare=0.1, folds=0.0, seed=51)
        P["breeches"] = G.leg_shell(B, "breeches", SECOND, B.z_waist - 0.03 * k, B.z_knee + 0.02 * k, clearance=0.012, bulge=0.035)
        P["legs"] = G.leg_shell(B, "stockings", WRAP, B.z_knee + 0.06 * k, B.z_ankle + 0.015 * k, clearance=0.005)
        P["cap"] = G.flat_cap(B)
        P["hat"] = G.brim_hat(B)
        P["ruff"] = G.ruff(B)
        P["gown"] = G.cloak(B, "gown", OUTER, B.z_ankle + 0.12 * k, half_top=2.75, half_hem=2.45, ease=0.026, seed=52, legmix=0.35)
        P["cloak"] = G.cloak(B, "cloak", OUTER, B.z_hip - 0.12 * k, half_top=2.6, half_hem=2.0, ease=0.03, seed=53)
        if s.get("child"):
            outfits = [O("doublet", 0.5, 0.5, ["doublet", "tabs", "breeches", "legs", "hair"]),
                       O("doublet-cap", 0.5, 0.5, ["doublet", "tabs", "breeches", "legs", "hair", "cap"])]
        else:
            outfits = [O("doublet-cap", 0.25, 0.0, ["doublet", "tabs", "breeches", "legs", "hair", "cap"]),
                       O("doublet-hat", 0.25, 0.0, ["doublet", "tabs", "breeches", "legs", "hair", "hat", "beard"]),
                       O("doublet", 0.2, 0.0, ["doublet", "tabs", "breeches", "legs", "hair", "beard"]),
                       O("doublet-hat-ruff", 0.1, 0.0, ["doublet", "tabs", "breeches", "legs", "hair", "hat", "ruff", "beard"]),
                       O("doublet-cloak-hat", 0.2, 0.0, ["doublet", "tabs", "breeches", "legs", "hair", "hat", "cloak"]),
                       O("gown-cap", 0.0, 0.45, ["doublet", "tabs", "breeches", "legs", "hair", "cap", "gown", "beard"]),
                       O("gown-hat", 0.0, 0.35, ["doublet", "tabs", "breeches", "legs", "hair", "hat", "gown", "beard"]),
                       O("gown-ruff", 0.0, 0.2, ["doublet", "tabs", "breeches", "legs", "hair", "cap", "gown", "ruff"])]
    else:
        P["bodice"] = G.torso_shell(B, "bodice", MAIN, neck_drop=0.02, bottom_z=B.z_waist - 0.03 * k, sleeve=0.99, clearance=0.009, smooth=4)
        P["skirt"] = G.skirt_loft(B, "gownskirt", MAIN, B.z_waist - 0.01 * k, 0.012, ease_top=0.02, ease_hem=0.05, flare=0.15, seed=54)
        P["coif"] = G.coif(B)
        P["hat"] = G.brim_hat(B, crown=0.1, brim=0.05)
        P["apron"] = G.apron(B, P["skirt"], B.z_waist - 0.03 * k, B.z_knee - 0.25 * k)
        P["ruff"] = G.ruff(B, width=0.045)
        P["belt"] = G.band_over(B, P["bodice"], B.z_waist - 0.015 * k, ease=0.007, half=0.01, slot=OUTER)
        outfits = [O("gown-coif", 0.35, 0.35, ["bodice", "skirt", "belt", "coif"]),
                   O("gown-coif-apron", 0.3, 0.3, ["bodice", "skirt", "belt", "coif", "apron"]),
                   O("gown-coif-hat", 0.2, 0.2, ["bodice", "skirt", "belt", "coif", "hat"]),
                   O("gown-coif-hat-apron", 0.07, 0.07, ["bodice", "skirt", "belt", "coif", "hat", "apron"]),
                   O("gown-coif-ruff", 0.08, 0.08, ["bodice", "skirt", "belt", "coif", "ruff"])]
        if s.get("child"):
            outfits = [O("gown-coif", 0.6, 0.6, ["bodice", "skirt", "belt", "coif"]),
                       O("gown-coif-apron", 0.4, 0.4, ["bodice", "skirt", "belt", "coif", "apron"])]
    return P, outfits


def barnet1471(B):
    k = B.k
    P = {}
    common(B, P, beard=False)
    P["jack"] = G.torso_shell(B, "jack", MAIN, neck_drop=0.0, bottom_z=B.z_hip - 0.02 * k, sleeve=0.98, clearance=0.03, smooth=4, collar=0.015)
    P["jackskirt"] = G.skirt_loft(B, "jackskirt", MAIN, B.z_hip + 0.02 * k, B.z_crotch - 0.13 * k, ease_top=0.04, ease_hem=0.05, flare=0.12, folds=0.0, seed=61)
    P["legs"] = G.leg_shell(B, "hose", SECOND, B.z_hip, B.z_ankle + 0.015 * k, clearance=0.006)
    P["belt"] = G.band_over(B, P["jack"], B.z_hip + 0.08 * k, ease=0.01)
    P["sallet"] = G.helmet(B, METAL, tail=0.06, rim_front=0.0, clearance=0.025)
    P["hood"] = G.hood_head(B, clearance=0.02, slot=HEADW, layer=6)
    outfits = [O("jack-sallet", 0.8, 0.8, ["jack", "jackskirt", "legs", "belt", "hair", "sallet"]),
               O("jack-hood", 0.2, 0.2, ["jack", "jackskirt", "legs", "belt", "hood"])]
    return P, outfits


def brentford1016(B):
    k = B.k
    P = {}
    common(B, P, beard=True)
    P["tunic"] = G.torso_shell(B, "tunic", MAIN, neck_drop=0.04, bottom_z=B.z_hip - 0.02 * k, sleeve=0.97, clearance=0.014)
    P["skirt"] = G.skirt_loft(B, "tunicskirt", MAIN, B.z_hip, B.z_knee + 0.03 * k, ease_top=0.025, ease_hem=0.035, flare=0.13, seed=71)
    P["legs"] = G.leg_shell(B, "trousers", SECOND, B.z_hip, B.z_knee - 0.02 * k, clearance=0.008)
    P["wraps"] = G.leg_shell(B, "wraps", WRAP, B.z_knee, B.z_ankle + 0.015 * k, clearance=0.011, smooth=2)
    P["belt"] = G.band_over(B, P["tunic"], B.z_hip + 0.07 * k, ease=0.007)
    P["helmet"] = G.helmet(B, METAL, tail=0.0, rim_front=0.015, clearance=0.022)
    P["cap"] = G.soft_cap(B)
    outfits = [O("tunic-helmet", 0.35, 0.35, ["tunic", "skirt", "legs", "wraps", "belt", "hair", "helmet", "beard"]),
               O("tunic-cap", 0.25, 0.25, ["tunic", "skirt", "legs", "wraps", "belt", "hair", "cap", "beard"]),
               O("tunic", 0.4, 0.4, ["tunic", "skirt", "legs", "wraps", "belt", "hair", "beard"])]
    return P, outfits


SETS = {
    "prehistoric": prehistoric,
    "roman": roman,
    "saxon": saxon,
    "medieval": medieval,
    "tudor": tudor,
    "barnet1471": barnet1471,
    "brentford1016": brentford1016,
}
