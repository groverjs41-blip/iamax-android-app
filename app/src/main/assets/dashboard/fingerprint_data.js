export const FINGERPRINT_DATA = {

  // ====== VERSIONES DE USER AGENT POR SISTEMA OPERATIVO ======
  userAgents: {
    Windows: {
      versions: [147, 143, 142, 134, 133, 132, 131, 130, 125, 120],
      template: "Mozilla/5.0 ({OS}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{VER} Safari/537.36",
      osStrings: [
        "Windows NT 10.0; Win64; x64",
        "Windows NT 11.0; Win64; x64",
        "Windows NT 6.3; WOW64",
        "Windows NT 10.0; WOW64"
      ]
    },
    macOS: {
      versions: [147, 143, 142, 134, 133, 132, 131, 130],
      template: "Mozilla/5.0 ({OS}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{VER} Safari/537.36",
      osStrings: [
        "Macintosh; Intel Mac OS X 10_15_7",
        "Macintosh; Intel Mac OS X 14_5",
        "Macintosh; Intel Mac OS X 13_6_7",
        "Macintosh; Apple M1 Mac OS X 14_4"
      ]
    },
    Android: {
      versions: [147, 143, 142, 134, 133, 131, 130],
      template: "Mozilla/5.0 ({OS}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{VER} Mobile Safari/537.36",
      osStrings: [
        "Linux; Android 14; Pixel 8",
        "Linux; Android 14; SM-S918B",
        "Linux; Android 13; SM-G991B",
        "Linux; Android 13; Pixel 7",
        "Linux; Android 12; SM-A525F",
        "Linux; Android 11; Redmi Note 10"
      ]
    },
    iOS: {
      versions: ["17.5", "17.4", "16.7", "16.6", "15.7"],
      template: "Mozilla/5.0 ({OS}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{SAFARI} Mobile/15E148 Safari/604.1",
      osStrings: [
        "iPhone; CPU iPhone OS 17_5 like Mac OS X",
        "iPhone; CPU iPhone OS 16_7 like Mac OS X",
        "iPad; CPU OS 17_5 like Mac OS X",
        "iPhone; CPU iPhone OS 15_7 like Mac OS X"
      ]
    },
    Linux: {
      versions: [147, 143, 142, 134, 133, 132, 131, 130],
      template: "Mozilla/5.0 ({OS}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{VER} Safari/537.36",
      osStrings: [
        "X11; Linux x86_64",
        "X11; Ubuntu; Linux x86_64",
        "X11; Fedora; Linux x86_64"
      ]
    }
  },

  // ====== FUENTES POR SISTEMA OPERATIVO ======
  fonts: {
    Windows: [
      "Arial","Arial Black","Bahnschrift","Calibri","Cambria","Candara",
      "Comic Sans MS","Consolas","Constantia","Corbel","Courier New",
      "Ebrima","Franklin Gothic","Gabriola","Gadugi","Georgia","Impact",
      "Ink Free","Javanese Text","Leelawadee UI","Lucida Console",
      "Lucida Sans Unicode","Malgun Gothic","Marlett","Microsoft Himalaya",
      "Microsoft JhengHei","Microsoft New Tai Lue","Microsoft PhagsPa",
      "Microsoft Sans Serif","Microsoft Tai Le","Microsoft YaHei",
      "MingLiU-ExtB","Mongolian Baiti","MS Gothic","MV Boli","Myanmar Text",
      "Nirmala UI","Palatino Linotype","Segoe MDL2 Assets","Segoe Print",
      "Segoe Script","Segoe UI","Segoe UI Emoji","Segoe UI Historic",
      "Segoe UI Symbol","SimSun","Sitka","Sylfaen","Symbol","Tahoma",
      "Times New Roman","Trebuchet MS","Verdana","Webdings","Wingdings",
      "Yu Gothic","Agency FB","Algerian","Andale Mono"
    ],
    macOS: [
      "American Typewriter","Andale Mono","Apple Braille","Apple Chancery",
      "Apple Color Emoji","Apple SD Gothic Neo","Apple Symbols",
      "AppleGothic","AppleMyungjo","Arial","Arial Black","Arial Hebrew",
      "Arial Narrow","Arial Rounded MT Bold","Arial Unicode MS","Avenir",
      "Avenir Next","Avenir Next Condensed","Baskerville","Big Caslon",
      "Bodoni 72","Bradley Hand","Brush Script MT","Chalkboard",
      "Chalkboard SE","Chalkduster","Charter","Cochin","Comic Sans MS",
      "Copperplate","Courier","Courier New","Didot","DIN Alternate",
      "DIN Condensed","Futura","Geneva","Georgia","Gill Sans","Helvetica",
      "Helvetica Neue","Herculanum","Hoefler Text","Impact","Lucida Grande",
      "Luminari","Marker Felt","Menlo","Microsoft Sans Serif","Monaco",
      "Noteworthy","Optima","Palatino","Papyrus","Phosphate","Rockwell",
      "San Francisco","Savoye LET","SignPainter","Skia","Snell Roundhand",
      "Tahoma","Times","Times New Roman","Trattatello","Trebuchet MS",
      "Verdana","Zapfino"
    ],
    Android: [
      "Roboto","Roboto Condensed","Roboto Mono","Noto Sans","Noto Serif",
      "Noto Color Emoji","Droid Sans","Droid Sans Mono","Droid Serif",
      "Cutive Mono","Coming Soon","Dancing Script","Carrois Gothic SC"
    ],
    iOS: [
      "Academy Engraved LET","Al Nile","American Typewriter","Apple Color Emoji",
      "Apple SD Gothic Neo","Arial","Arial Hebrew","Arial Rounded MT Bold",
      "Avenir","Avenir Next","Avenir Next Condensed","Baskerville","Bodoni 72",
      "Bradley Hand","Chalkboard SE","Chalkduster","Cochin","Copperplate",
      "Courier","Courier New","Damascus","Devanagari Sangam MN","Didot",
      "Euphemia UCAS","Farah","Futura","Geeza Pro","Georgia","Gill Sans",
      "Helvetica","Helvetica Neue","Hiragino Sans","Hoefler Text","Kailasa",
      "Kefa","Marker Felt","Menlo","Optima","Palatino","Papyrus","Party LET",
      "PingFang HK","PingFang SC","PingFang TC","Savoye LET","Snell Roundhand",
      "Symbol","Thonburi","Times New Roman","Trebuchet MS","Verdana","Zapfino"
    ],
    Linux: [
      "Bitstream Vera Sans","Bitstream Vera Serif","Bitstream Vera Sans Mono",
      "DejaVu Sans","DejaVu Sans Mono","DejaVu Serif","FreeMono","FreeSans",
      "FreeSerif","Liberation Mono","Liberation Sans","Liberation Serif",
      "Noto Sans","Noto Serif","Noto Mono","Ubuntu","Ubuntu Mono",
      "Ubuntu Condensed","Cantarell","Droid Sans","Nimbus Roman","Nimbus Sans"
    ]
  },

  // ====== PROVEEDORES Y RENDERIZADORES WEBGL POR SO ======
  webgl: {
    Windows: [
      { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, Radeon RX RX550/550 Series (0x00001636) Direct3D11 vs_5_0 ps_5_0, D3D11)" },
      { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)" },
      { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
      { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
      { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
      { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
      { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" }
    ],
    macOS: [
      { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, Apple M1, OpenGL 4.1)" },
      { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, Apple M2, OpenGL 4.1)" },
      { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, Apple M3 Pro, OpenGL 4.1)" },
      { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 640, OpenGL 4.1)" },
      { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon Pro 5500M OpenGL Engine, OpenGL 4.1)" }
    ],
    Android: [
      { vendor: "Qualcomm", renderer: "Adreno (TM) 730" },
      { vendor: "Qualcomm", renderer: "Adreno (TM) 740" },
      { vendor: "Qualcomm", renderer: "Adreno (TM) 660" },
      { vendor: "ARM", renderer: "Mali-G78 MP14" },
      { vendor: "ARM", renderer: "Mali-G710 MC10" },
      { vendor: "ARM", renderer: "Mali-G715" }
    ],
    iOS: [
      { vendor: "Apple Inc.", renderer: "Apple GPU" },
      { vendor: "Apple GPU", renderer: "Apple A15 GPU" },
      { vendor: "Apple GPU", renderer: "Apple A16 GPU" },
      { vendor: "Apple GPU", renderer: "Apple A17 Pro GPU" }
    ],
    Linux: [
      { vendor: "Google Inc. (Mesa)", renderer: "ANGLE (Mesa, llvmpipe (LLVM 15.0.7 256 bits), OpenGL 4.5)" },
      { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)" },
      { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 6600 (navi23), OpenGL 4.6)" },
      { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.6)" }
    ]
  },

  // ====== RESOLUCIONES TÍPICAS POR SO ======
  resolutions: {
    Windows: ["1920x1080","2560x1440","1366x768","3840x2160","1536x864"],
    macOS:   ["2560x1600","2880x1800","3024x1964","1440x900","5120x2880"],
    Android: ["1080x2400","1080x2340","1440x3200","720x1600"],
    iOS:     ["1170x2532","1284x2778","1179x2556","828x1792","1290x2796"],
    Linux:   ["1920x1080","2560x1440","1366x768","1680x1050"]
  }
};
