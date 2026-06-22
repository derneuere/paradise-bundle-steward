# Profile/Burnout Paradise/PDLC Profile

> Source: https://burnout.wiki/wiki/Profile/Burnout_Paradise/PDLC_Profile (mirrored 2026-06-22)

The PDLC profile stores entitlements for the Toys, Legendary Cars, and Boost Specials.

Adding traffic vehicles to the entitlements makes them drivable offline, though it still does not make them selectable in the junkyard. It would likely have the same effect on other undrivable vehicles.

Entries in this chunk, when converted to a CarData entry at runtime, have `mbUnlockSequenceAlreadyShown` hardcoded to 1, `mfUnlockDeformedAmount` set to 0, and `meUnlockType` set to 8.

## Structures

### PDLC Profile

#### PlayStation 3, Xbox 360

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number | 2 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x18 | CgsID[3] | ? | Spawn vehicle IDs | Car, bike, and plane, respectively |
| 0x20 | 0xC | uint32_t[3] | ? | Spawn vehicle update versions | Car, bike, and plane, respectively |
| 0x2C | 0x4 | uint32_t | ? | Spawn vehicle index |  |
| 0x30 | 0x1 | bool | ? | Show Time Savers pack popup | PrizeTicket |
| 0x31 | 0x7 |  |  | Padding |  |
| 0x38 | 0x1C28 | ? | ? | DLC entitlements | See entitlements |

#### PC, Remastered

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number | 3 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x18 | CgsID[3] | ? | Spawn vehicle IDs | Car, bike, and plane, respectively |
| 0x20 | 0xC | uint32_t[3] | ? | Spawn vehicle update versions | Car, bike, and plane, respectively |
| 0x2C | 0x4 | uint32_t | ? | Spawn vehicle index |  |
| 0x30 | 0x1 | bool | ? | Show Time Savers pack popup | PrizeTicket |
| 0x31 | 0x7 |  |  | Padding |  |
| 0x38 | 0x1C28 | ? | ? | DLC entitlements | See entitlements |
| 0x1C60 | 0x1 | bool | ? |  | On1stVehCon |
| 0x1C61 | 0x7 |  |  | Padding |  |

### Entitlements

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | uint32_t | ? | Number of entitlements |  |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0xE10 | CgsID[450] | ? | Vehicle IDs |  |
| 0xE18 | 0x384 | int16_t[450] | ? | Entry indices |  |
| 0x119C | 0x1C2 | uint8_t[450] | ? | Color indices and version flags | See color and flags |
| 0x135E | 0x1C2 | uint8_t[450] | ? | Palette indices and mileage flag | See palette and flags |
| 0x1520 | 0x708 | float32_t[450] | ? | Vehicle mileage |  |

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
| ? | 0 | 2 (1.0) |
| ? | 1 | 3 (1.3) |
| ? | 2 | 4 (1.4) |
| ? | 3 | 7 (1.7) |
