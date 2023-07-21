const { DefinePlugin } = require('webpack');
const {
  createJoinFunction,
  createJoinImplementation,
  asGenerator,
  defaultJoinGenerator,
} = require('resolve-url-loader');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const path = require('path');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const { merge } = require('webpack-merge');

// call default generator then pair different variations of uri with each base
const myGenerator = asGenerator((item, ...rest) => {
  const defaultTuples = [...defaultJoinGenerator(item, ...rest)];
  if (item.uri.includes('./assets')) {
    return defaultTuples.map(([base]) => {
      if (base.includes('@patternfly/patternfly')) {
        return [
          base,
          path.relative(
            base,
            path.resolve(
              __dirname,
              '../node_modules/@patternfly/patternfly',
              item.uri
            )
          ),
        ];
      }
    });
  }
  return defaultTuples;
});

const baseConfig = {
  mode: process.env.NODE_ENV || 'development',
  devtool: 'source-map',
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
    alias: {
      // ...searchIgnoredStyles(path.resolve(__dirname, '../')),
    },
  },
};

const stylesConfig = {
  mode: 'production',
  name: 'styles',
  entry: path.resolve(__dirname, '../src/styles/styles.scss'),
  output: {
    path: path.resolve(__dirname, '../public'),
    filename: 'styles.css',
  },
  module: {
    rules: [
      {
        test: /\.s?[ac]ss$/,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader',
          {
            loader: 'resolve-url-loader',
            options: {
              join: createJoinFunction(
                'myJoinFn',
                createJoinImplementation(myGenerator)
              ),
            },
          },
          {
            loader: 'sass-loader',
            options: {
              sourceMap: true,
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: '[name].css',
    }),
  ],
};

const serverConfig = {
  devtool: 'eval-source-map',
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
    puppeteerWorker: {
      import: path.resolve(__dirname, '../src/browser/puppeteerWorker.ts'),
      chunkLoading: false,
    },
  },
  output: {
    path: path.resolve(__dirname, '../dist'),
    filename: '[name].js',
    publicPath: './', // file-loader prepends publicPath to the emited url. without this, react will complain about server and client mismatch
  },
  externals: {
    // puppeteer cannot be bundled via webpack. It will break the rendering. Pupetter will be loaded via node_modules even in prod version
    puppeteer: "require('puppeteer')",
  },
  module: {
    rules: [
      { test: /\.(js|tsx?)$/, loader: 'ts-loader', exclude: /node_modules/ },
      {
        test: /\.s?[ac]ss$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'sass-loader'],
      },
      {
        // file-loader config must match client's (except 'emitFile' property)
        test: /\.(jpg|png|gif|svg)$/,
        use: {
          loader: 'file-loader',
          options: {
            outputPath: 'images',
            name: '[name].[contenthash].[ext]',
            emitFile: false,
          },
        },
      },
    ],
  },
  plugins: [
    new CleanWebpackPlugin({
      cleanOnceBeforeBuildPatterns: ['!public/**'],
    }),
    new DefinePlugin({
      __Server__: JSON.stringify(true),
    }),
    new MiniCssExtractPlugin({
      filename: '../public/[name].css',
    }),
  ],
};

const srConfig = merge(baseConfig, serverConfig);

module.exports = [srConfig, stylesConfig];
