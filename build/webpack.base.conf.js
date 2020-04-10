const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ExtractTextPlugin = require('extract-text-webpack-plugin');
const ReplaceInFileWebpackPlugin = require('replace-in-file-webpack-plugin');

const packageJson = require('../package.json');

const ExtractTextPluginLight = new ExtractTextPlugin('./css/panel.light.css');
const ExtractTextPluginDark = new ExtractTextPlugin('./css/panel.dark.css');


function resolve(dir) {
  return path.join(__dirname, '..', dir)
}

module.exports = {
  target: 'node',
  context: resolve('src'),
  entry: {
    './module': './module.ts'
  },
  output: {
    filename: '[name].js',
    path: resolve('dist'),
    libraryTarget: 'amd'
  },
  externals: [
    // remove the line below if you don't want to use buildin versions
    'lodash', 'moment', 'angular', 'react', 'react-dom',
    '@grafana/ui', '@grafana/data', '@grafana/runtime',
    function (context, request, callback) {
      var prefix = 'grafana/';
      if (request.indexOf(prefix) === 0) {
        return callback(null, request.substr(prefix.length));
      }
      callback();
    }
  ],
  plugins: [
    new webpack.optimize.OccurrenceOrderPlugin(),
    new CopyWebpackPlugin([
      { from: '../README.md' },
      { from: 'plugin.json' },
      { from: 'partials/**/*' },
      { from: 'assets/**/*' }
    ]),
    new ReplaceInFileWebpackPlugin([
      {
        dir: 'dist',
        files: ['plugin.json'],
        rules: [
          {
            search: '%VERSION%',
            replace: packageJson.version,
          },
          {
            search: '%TODAY%',
            replace: new Date().toISOString().substring(0, 10),
          },
        ],
      },
    ]),
    ExtractTextPluginLight,
    ExtractTextPluginDark
  ],
  resolve: {
    alias: {
      'src': resolve('src')
    },
    extensions: ['.tsx', '.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loaders: [
          'ts-loader'
        ],
        exclude: /node_modules/,
      },
      {
        test: /\.html$/,
        use: 'raw-loader'
      },
      {
        test: /light\.scss$/,
        exclude: [/node_modules/],
        use: ExtractTextPluginLight.extract({
          fallback: 'style-loader',
          use: ['css-loader', 'sass-loader']
        }),
      },
      {
        test: /dark\.scss$/,
        exclude: [/node_modules/],
        use: ExtractTextPluginDark.extract({
          fallback: 'style-loader',
          use: ['css-loader', 'sass-loader']
        }),
      }
    ]
  }
}
