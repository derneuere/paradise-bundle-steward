# Profile/Burnout Paradise/Recent Players Profile

> Source: https://burnout.wiki/wiki/Profile/Burnout_Paradise/Recent_Players_Profile (mirrored 2026-06-22)

The recent players profile stores a list of players encountered online. It is specific to the original PC version of Burnout Paradise due to that version using a discreet friends list. Other versions use either the platform's built-in services or use Origin.

## Structures

### Recent players profile

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber | Version number |  |
| 0x4 | 1F44 | Array<?, 100u> | ? | Recent players list | Not padded after length. See recent player |

### Recent player

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x14 | PlayerName | ? | Player name |  |
| 0x4 | 0xC | DateAndTime | ? | Date encountered |  |

### CgsNetwork::PlayerName

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x14 | char[20] | macName | Online player's name |  |

### CgsSystem::DateAndTime

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x1 | bool | mbIsLocal | Defines whether the saved time is in a local time zone or UTC |  |
| 0x1 | 0x3 |  |  | Padding |  |
| 0x8 | 0x8 | FILETIME | mSystemTime | The time value |  |
