const ngAnnotatePlugin = require('ng-annotate-webpack-plugin');

const baseWebpackConfig = require('./webpack.base.conf');

var conf = baseWebpackConfig;
conf.mode = 'production';
conf.plugins.push(new ngAnnotatePlugin());

module.exports = baseWebpackConfig;
