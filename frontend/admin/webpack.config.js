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
      title: 'Cell Architecture Admin'
    }),
    new webpack.DefinePlugin({
      'process.env.ADMIN_API_URL': JSON.stringify(process.env.ADMIN_API_URL || ''),
      'process.env.INTRO_URL': JSON.stringify(process.env.INTRO_URL || ''),
      // Optional: absolute URL of the audience router page for the
      // "Scan to join" QR card. When unset the card falls back to
      // `${window.location.origin}/router.html` (the router pages live on
      // the admin host). Edge mode sets this to the single edge hostname.
      'process.env.ROUTER_URL': JSON.stringify(process.env.ROUTER_URL || '')
    })
  ],
  devServer: {
    port: 3001,
    hot: true
  }
};