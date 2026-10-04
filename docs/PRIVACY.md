# Privacy Policy — Failure Reconstructed uploader

_Last updated: 26 September 2026_

## Summary

This application has one user: its author. It collects no personal data from anyone else,
has no analytics, no tracking, no advertising, and no third-party data sharing.

Source code: https://github.com/eyazan/youtube-otomasyon

## What data is handled

| Data | Why | Where it is kept |
|---|---|---|
| TikTok OAuth access and refresh tokens for the author's own account | To upload the author's own videos to their own TikTok inbox | Encrypted GitHub Actions secrets and a local `.env` file. Never committed to the repository. |
| The `publish_id` returned by TikTok for each upload, plus the upload date | So the same video is never uploaded twice | `icerik/tiktok.json` in the repository |
| Video files produced by the author | To be uploaded | The author's own machine and GitHub Actions runners |

No TikTok user profile data, follower data, viewer data, comments or messages are
requested, read or stored. The only scope requested is `video.upload`.

## Data from other people

None is collected. The application does not authenticate any user other than its author,
and offers no interface through which another person could submit data.

## Retention and deletion

Upload records are kept in the public repository's history. Tokens can be revoked at any
time by the author from TikTok's settings, which immediately ends the application's
access. Deleting the repository removes all stored records.

## Children

The application is not directed at children and collects no data from anyone.

## Changes

This policy may be updated by editing this file in the repository above. The revision
history is public.

## Contact

erdmyzn@gmail.com
