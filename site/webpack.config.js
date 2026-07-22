const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

module.exports = {
  entry: {
    main: './src/index.tsx',
    primer: './src/primer.tsx',
    slides: './src/slides.tsx',
    operations: './src/operations.tsx',
    flags: './src/flags.tsx'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].[contenthash].js',
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
      filename: 'index.html',
      chunks: ['main'],
      title: 'Cell-Based Architecture — Interactive Guide'
    }),
    new HtmlWebpackPlugin({
      template: './src/primer.html',
      filename: 'primer.html',
      chunks: ['primer'],
      title: 'Before Cells — Why Big Systems Fail Big'
    }),
    new HtmlWebpackPlugin({
      template: './src/slides.html',
      filename: 'slides.html',
      chunks: ['slides'],
      title: 'Cell-Based Architecture — Slides'
    }),
    new HtmlWebpackPlugin({
      template: './src/operations.html',
      filename: 'operations.html',
      chunks: ['operations'],
      title: 'Operating Cells — Idempotency, Quorum & Consensus'
    }),
    new HtmlWebpackPlugin({
      // Hidden feature-flags page (noindex; nothing links here).
      template: './src/flags.html',
      filename: 'flags.html',
      chunks: ['flags'],
      title: 'Cell-Based Architecture — Feature flags'
    }),
    new webpack.DefinePlugin({
      // Optional: URL of a live AWS demo deployment's admin dashboard. When
      // set (deploy-frontend.sh does this), sections link to the real thing;
      // generic builds (Vercel/Pages) omit the links entirely.
      'process.env.DEMO_ADMIN_URL': JSON.stringify(process.env.DEMO_ADMIN_URL || '')
    })
  ],
  devServer: {
    port: 3002,
    hot: true
  }
};
