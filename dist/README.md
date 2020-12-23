# Grafana Chartwerk Panel (beta)

<p align="center"><img src="https://user-images.githubusercontent.com/66464000/84520316-6c6fab00-ace4-11ea-9bfc-29ca73e5105e.png" width="150" height="150" /></div>

[![Build Status](https://travis-ci.org/chartwerk/grafana-chartwerk-app.svg?branch=master)](https://travis-ci.org/chartwerk/grafana-chartwerk-app)

 **Grafana Chartwerk Panel** renders metrics using ChartWerk libraries. For now, it can render as a line and a series of bars. We are working on adding new visualizations.

![image](https://user-images.githubusercontent.com/66464000/84491085-10416280-acb5-11ea-8af0-2761ed97aecc.png)
![image](https://user-images.githubusercontent.com/66464000/84491069-0b7cae80-acb5-11ea-959b-ef67835c8055.png)

## Features

- 2 types of visualizations:
  - line-chart
  - bar-chart
- ability to make panel's time range independent of dashboard's (doesn't work in Grafana 7).
- ability to display template variables inside the panel.
- "Charge" mode: green color for positive graph's slope, red color for negative graph's slope.
- confidence interval (for line).
- customizable X-axis labels.
- customizable grid interval.

## Installation
### Linux / Mac OS X
- Navigate to either: 
  - `<GRAFANA_PATH>/data/plugins` (when installed from tarball or source) 
  - or `/var/lib/grafana/plugins` (when installed from `.deb`/`.rpm` package)

- Download ChartWerk panel
```
wget https://github.com/chartwerk/grafana-chartwerk-app/archive/0.2.0.zip
```

- Unpack downloaded files
```
unzip 0.2.0.zip
```

- Restart grafana-server
  - For grafana installed via Standalone Linux Binaries:
    - Stop any running instances of grafana-server
    - Start grafana-server by:
      ```$GRAFANA_PATH/bin/grafana-server```
  - For grafana installed via Package Manager:
    - type in ```systemctl restart grafana-server```

### Grafana in Docker
You can install ChartWerk panel to Grafana in Docker passing it as environment variable (as described in [Grafana docs](http://docs.grafana.org/installation/docker/#installing-plugins-from-other-sources))

```bash
docker run \
  -p 3000:3000 \
  -e "GF_INSTALL_PLUGINS=https://github.com/chartwerk/grafana-chartwerk-app/archive/0.2.0.zip;corpglory-chartwerk-panel" \
  grafana/grafana
```
