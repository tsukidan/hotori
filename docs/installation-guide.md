# Hotori installation and recovery guide

1. Install Discord for Windows and open it once.
2. Install [Vencord](https://vencord.dev/download/), then fully quit and reopen Discord.
3. Download `hotori.exe` from [Hotori Releases](https://github.com/tsukidan/hotori/releases).
4. Fully quit Discord, open Hotori, and choose **Install**. Reopen Discord afterward.

## Windows antivirus warning

Windows may flag Hotori as a Trojan and quarantine or remove hotori.exe. We believe this is a false positive; Microsoft has not confirmed that assessment. A local build has been affected; we have not established which published releases are affected.

If Hotori disappears, open **Windows Security → Virus & threat protection → Protection history** and check whether the affected file is your Hotori download. Only if you have verified its source and are satisfied it is safe, expand that specific detection and choose **Actions → Restore** or **Allow on device**, whichever Windows offers. Download hotori.exe again from this repository's Releases page if the file was removed. Do not disable antivirus protection or exclude an entire folder.

If you are unsure, leave the file quarantined and report the detection name and app version in a GitHub issue. Recovery instructions are also available in [the online guide](https://github.com/tsukidan/hotori/blob/main/docs/installation-guide.md), even when the app cannot open.

Restoring the app does not require uninstalling the theme or resetting your saved settings.
