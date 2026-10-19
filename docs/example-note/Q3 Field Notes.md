Follow-ups from the August site visit, cross-referenced
against the Maintenance Handbook.

> [!important] Sign-off required
> Section 3 needs an engineer signature before this leaves the vault.

## Readings

| Sensor | Location | Reading | Status |
| --- | ---: | ---: | :---: |
| TH-01 | North wall | 21.4 C | OK |
| TH-02 | Plant room | 34.9 C | Review |
| RH-07 | Roof void | 68 %RH | OK |

The plant room figure is outside the tolerance band and was logged as
#followup/urgent on the day.

## Calibration snippet

```python
def calibrate(raw: float, offset: float = 0.0) -> float:
    """Apply the sensor offset from the last service visit."""
    return round(raw - offset, 2)
```

> [!warning] Drift
> TH-02 has drifted twice this quarter. Replace before the next cycle.

## Actions

- [x] Log readings against the asset register
- [ ] Order a replacement TH-02
- [ ] Book the engineer sign-off

Refer back to [[Escalation]] for the escalation path.
