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
      'process.env.ADMIN_URL': JSON.stringify(process.env.ADMIN_URL || '')
    })
  ],
  devServer: {
    port: 3000,
    hot: true
  }
};