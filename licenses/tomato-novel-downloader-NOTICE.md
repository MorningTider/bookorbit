# Optional Tomato Novel Downloader runtime

- Upstream: https://github.com/zhongbai2333/Tomato-Novel-Downloader
- Version: v2.4.15, commit e2197970c366180bb566b8acfbda67cc1331a1ef.
- Copyright (c) 2025 zhongbai2333. Upstream declares MIT; see the adjacent full license.
- The executable is not included in this repository or the default BookOrbit image. The optional installer verifies the pinned release hash before replacing a binary.
- BookOrbit's integration starts the runtime as an authenticated loopback child process. It does not distribute account credentials or decrypt paid chapters.
- The release references a non-public upstream API crate. The upstream license declaration is not an independently audited binary SBOM. The BookOrbit adapter does not relicense that component or downloaded books.
