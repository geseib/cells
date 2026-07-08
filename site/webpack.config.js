const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: './src/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash].js',
    clean: true
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    // The shared ../backend/lib/consistent-hash.ts imports crypto-js; resolve
    // it from site/node_modules so the site builds standalone (Vercel/Pages)
    // without installing backend dependencies.
    modules: [path.resolve(__dirname, 'node_modules'), 'node_modules']
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
      title: 'Cell-Based Architecture — Interactive Guide'
    })
  ],
  devServer: {
    port: 3002,
    hot: true
  }
};
