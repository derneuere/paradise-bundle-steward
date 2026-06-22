# Profile/Burnout Paradise/Cop Profile

> Source: https://burnout.wiki/wiki/Profile/Burnout_Paradise/Cop_Profile (mirrored 2026-06-22)

The cop profile stores entitlements for all cop cars. It is essentially a limited version of the PDLC Profile.

Though space is allocated to 35 vehicles, only 33 entries are used. This is because the PCPD Rai-Jin Turbo and PCPD Olympus were removed during development.

## Structures

### Cop Profile

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number | 2 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x18 | CgsID[3] | ? | Spawn vehicle IDs | Car, bike, and plane, respectively |
| 0x20 | 0xC | uint32_t[3] | ? | Spawn vehicle update versions | Car, bike, and plane, respectively |
| 0x2C | 0x4 | uint32_t | ? | Spawn vehicle index |  |
| 0x30 | 0x238 | ? | ? | Cop entitlements | See entitlements |

### Entitlements

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | uint32_t | ? | Number of entitlements |  |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x118 | CgsID[35] | ? | Vehicle IDs |  |
| 0x120 | 0x46 | int16_t[35] | ? | Entry indices |  |
| 0x166 | 0x23 | uint8_t[35] | ? | Color indices and version flags | See color and flags |
| 0x189 | 0x23 | uint8_t[35] | ? | Palette indices and mileage flag | See palette and flags |
| 0x1AC | 0x8C | float32_t[35] | ? | Vehicle mileage |  |

### Color and flags

| Offset (bits) | Length (bits) | Name | Description | Comments |
| --- | --- | --- | --- | --- |
| 0 | 2 | ? | Vehicle update version | See version flags |
| 2 | 6 | ? | Color index |  |

### Palette and flags

| Offset (bits) | Length (bits) | Name | Description | Comments |
| --- | --- | --- | --- | --- |
| 0 | 1 | ? | Read mileage | Mileage reverts if not set |
| 1 | 7 | ? | Palette index |  |

## Enumerations

### Version flags

| Name | Value | Comments |
| --- | --- | --- |
| ? | 0 | 8 (1.8) |
| ? | 1 | 2 (1.0) |
| ? | 2 | 2 (1.0) |
| ? | 3 | 2 (1.0) |
