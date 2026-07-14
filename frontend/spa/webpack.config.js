const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

module.exports = {
  entry: './src/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash].js',
    clean: true
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/index.html',
      title: 'AWS Cell Architecture Demo'
    }),
    new webpack.DefinePlugin({
      'process.env.CELL_API_URL': JSON.stringify(process.env.CELL_API_URL || ''),
      // This cell's own id (already known per-cell at build time). Used to
      // detect edge mode at runtime: served under /{cellId}/ the SPA calls
      // the relative /{cellId}/api instead of the absolute CELL_API_URL.
      'process.env.CELL_ID': JSON.stringify(process.env.CELL_ID || ''),
      // This cell's palette index (sorted-cellId order across ALL cells),
      // computed by deploy-frontend.sh so the page's identity color matches
      // the admin dashboard and site palette (CELL_COLOR_VARS). When unset,
      // App.tsx falls back to hashing CELL_ID (local builds only).
      'process.env.CELL_INDEX': JSON.stringify(process.env.CELL_INDEX || ''),
      'process.env.ADMIN_URL': JSON.stringify(process.env.ADMIN_URL || ''),
      'process.env.INTRO_URL': JSON.stringify(process.env.INTRO_URL || '')
    })
  ],
  devServer: {
    port: 3000,
    hot: true
  }
};