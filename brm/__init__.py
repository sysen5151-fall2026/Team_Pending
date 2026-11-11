"""Biodiversity Risk Map (BRM) engine.

Implements IDEF0 function F.2 *Assess Spatial Biodiversity Conditions*
(mechanism C.2 Biodiversity Risk Map) as seven Level-2 modules
(F.2.1-F.2.7, mechanisms C.2.1-C.2.7) and decomposes F.2.3
*Calculate Habitat Quality* into six Level-3 component modules
(F.2.3.1-F.2.3.6, mechanisms C.2.3.1-C.2.3.6).

Every public function is registered with :func:`brm.idef0.idef0` so the
code itself can be checked against the Innoslate model (model/idef0.json).
"""
__version__ = "1.0.0"
