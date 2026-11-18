# Homebridge Wifi Connect

This is the WiFi setup portal for the Homebridge Raspberry Pi Image.

This is a fork of [hoobs-org/portal](https://github.com/hoobs-org/portal) and credits go to HOOBS / Michael J Kellsy for this project.

## What it does

It runs once at every boot, as `root`, and then ends.

1. It waits up to 20 seconds for a network connection (a cable or WiFi).
   - If there is a connection, it ends. Nothing else happens.
2. If a WiFi network is already saved on the device, it ends.
   - NetworkManager keeps trying a saved network by itself. Example: after a power cut the router
     may start later than the Pi. The Pi joins the network when the router is back.
3. Only when there is no connection **and** no saved WiFi network, it starts the setup hotspot:
   - a WiFi network called `Homebridge WiFi Setup (XXXX)`,
   - a web page where you pick your WiFi network and type its password.
4. When the device has joined your WiFi network, the hotspot stops and the program ends.
5. If nobody uses the setup page for 5 minutes, the hotspot stops and the check starts again at step 1.

A WiFi network that could not be joined (for example a wrong password) is not kept as saved, so the
hotspot comes back and you can try again.

## What it needs

- Node.js 20.19 or newer.
- NetworkManager (`nmcli`), `ip`, `hostapd` and `dnsmasq`, in the normal system folders.
  - `hostapd` and `dnsmasq` must not be enabled as system services. This program starts its own
    copies with its own config files while the hotspot is on, and stops them again.

```sh
sudo apt install network-manager dnsmasq hostapd
sudo systemctl disable --now dnsmasq hostapd
```

## Usage

```sh
wifi-connect [options] [start]

  -v, --version      output the current version
  -d, --debug        turn on debug level logging
  -p, --port <port>  change the port the portal runs on (default 80)
  -h, --help         display this help
```

## How it is built

- `main.js` reads the options and starts the supervisor.
- `server/supervisor.js` holds the rules from "What it does".
- `server/` is the small web server (express) behind the setup page.
- `network/` talks to the system. It runs `nmcli`, `ip`, `hostapd` and `dnsmasq`.
  - Every program is started with a list of arguments. No shell is used.
  - WiFi names, passwords and interface names are checked before they are used.
- `source/` is the setup page (Vue). `npm run build` builds it into `interface/`.

## Development

```sh
npm ci --ignore-scripts
npm run lint
npm test          # uses fake nmcli, ip, hostapd and dnsmasq programs; needs no network and no root
npm run build     # builds the setup page into ./interface
```

Every dependency has an exact version. Runtime dependencies are bundled into the published package,
so an install always gets the versions that were tested.

## Release

1. Set the new version in `package.json` (`npm version <version> --no-git-tag-version`).
2. `npm ci --ignore-scripts`
3. `npm publish` (this runs the lint, the tests and the page build first).
4. Set the same version for `@homebridge/wifi-connect` in `stable/package.json` of
   [homebridge-raspbian-image](https://github.com/homebridge/homebridge-raspbian-image).

## Legal

HOOBS and the HOOBS logo are registered trademarks of HOOBS Inc. Copyright (C) 2021 HOOBS Inc. All rights reserved.
