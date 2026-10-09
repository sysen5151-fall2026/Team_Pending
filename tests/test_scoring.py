import pandas as pd
from scripts.build_risk_grid import normalize

def habitat_risk(habitat_suitability,degradation,z=2.5,k=0.5):
    quality=habitat_suitability*(1-degradation**z/(degradation**z+k**z))
    return 1-quality

def test_normalize_range():
    result=normalize(pd.Series([2,4,6]))
    assert result.tolist()==[0.0,0.5,1.0]

def test_constant_normalizes_to_zero():
    assert normalize(pd.Series([3,3])).tolist()==[0.0,0.0]

def test_invest_risk_increases_with_degradation():
    assert habitat_risk(1.0,0.8)>habitat_risk(1.0,0.2)

def test_zero_degradation_preserves_suitable_habitat():
    assert habitat_risk(1.0,0.0)==0.0
