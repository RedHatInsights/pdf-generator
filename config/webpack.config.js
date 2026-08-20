const { DefinePlugin, container } = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const path = require('path');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const { merge } = require('webpack-merge');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const isProduction = process.env.NODE_ENV === 'production';

const baseConfig = {
  mode: process.env.NODE_ENV || 'development',
  devtool: isProduction ? 'hidden-source-map' : 'source-map',
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
  },
};

const serverConfig = {
  ...(isProduction ? {} : { devtool: 'eval-source-map' }),
  name: 'server',
  target: 'node',
  externalsPresets: {
    node: true,
  },
  ignoreWarnings: [
    {
      /*
       * Express compilation issue:
       * WARNING in ../node_modules/express/lib/view.js 81:13-25 Critical dependency: the request of a dependency is an expression
       * more at: https://github.com/webpack/webpack/issues/1576
       */
      module: /express/,
      message:
        /Critical\sdependency:\sthe\srequest\sof\sa\sdependency\sis\san\sexpression/,
    },
  ],
  entry: {
    server: path.resolve(__dirname, '../src/server/index.ts'),
  },
  output: {
    path: path.resolve(__dirname, '../dist'),
    filename: '[name].js',
  },
  externals: {
    // puppeteer cannot be bundled via webpack. It will break the rendering. Pupetter will be loaded via node_modules even in prod version
    puppeteer: "require('puppeteer')",
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /(node_modules)/,
        use: {
          loader: 'swc-loader',
          options: {
            jsc: {
              transform: {
                react: {
                  runtime: 'automatic',
                },
              },
              parser: {
                syntax: 'typescript',
                tsx: true,
              },
            },
          },
        },
      },
    ],
  },
  plugins: [
    new CleanWebpackPlugin({
      // Keep dist/public assets across builds, but drop stale browser source maps
      // (client production builds use devtool:false and must not ship leftover *.map).
      cleanOnceBeforeBuildPatterns: ['**/*', '!public/**', 'public/**/*.map'],
    }),
    new DefinePlugin({
      __Server__: JSON.stringify(true),
    }),
  ],
};

const moduleFederationPlugin = new container.ModuleFederationPlugin({
  filename: 'pdfClient.[contenthash].js',
  library: {
    type: 'global',
    name: 'pdfClient',
  },
  shared: {
    react: {
      requiredVersion: '*',
      singleton: true,
    },
    'react-dom': {
      requiredVersion: '*',
      singleton: true,
    },
    // Ensure react/jsx-runtime is in the webpack shared scope.
    // Federated modules using the automatic JSX transform require it.
    'react/jsx-runtime': {
      requiredVersion: '*',
      singleton: true,
    },
    'react-intl': {
      requiredVersion: '*',
      singleton: true,
    },
    'react-router-dom': {
      requiredVersion: '*',
      singleton: true,
    },
    '@scalprum/core': {
      requiredVersion: '*',
      singleton: true,
    },
    '@scalprum/react-core': {
      requiredVersion: '*',
      singleton: true,
    },
  },
});

const clientConfig = {
  name: 'client',
  target: 'web',
  // Do not emit browser .map files in production — they would be HTTP-reachable
  // under /public even with hidden-source-map (guessable *.js.map URLs).
  ...(isProduction ? { devtool: false } : {}),
  entry: {
    client: path.resolve(__dirname, '../src/client/client.ts'),
  },
  output: {
    path: path.resolve(__dirname, '../dist/public'),
    filename: '[name].js',
  },
  plugins: [
    moduleFederationPlugin,
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, '../src/client/index.html'),
      publicPath: '/public/',
    }),
    new MiniCssExtractPlugin(),
  ],
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /(node_modules)/,
        use: {
          loader: 'swc-loader',
          options: {
            jsc: {
              transform: {
                react: {
                  runtime: 'automatic',
                },
              },
              parser: {
                syntax: 'typescript',
                tsx: true,
              },
            },
          },
        },
      },
      {
        test: /\.css$/i,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
};

const srConfig = merge(baseConfig, serverConfig);

const clConfig = merge(baseConfig, clientConfig);

module.exports = [srConfig, clConfig];
