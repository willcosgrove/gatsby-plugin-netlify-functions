"use strict";

var _path = _interopRequireDefault(require("path"));

var _fs = _interopRequireDefault(require("fs"));

var _glob = _interopRequireDefault(require("glob"));

var _base = _interopRequireDefault(require("base-64"));

var _lodash = require("lodash");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// import babel from "@babel/core";
var babel = require('@babel/core');

function handleErr(err, res) {
  res.statusCode = 500;
  res.send(`Function invocation failed: ` + err.toString());
  console.log(`Error during invocation: `, err);
}

function createCallback(res) {
  return function callback(err, lambdaResponse) {
    if (err) {
      handleErr(err, res);
      return;
    }

    res.statusCode = lambdaResponse.statusCode;

    for (const key in lambdaResponse.headers) {
      res.setHeader(key, lambdaResponse.headers[key]);
    }

    res.write(lambdaResponse.isBase64Encoded ? _base.default.decode(lambdaResponse.body) : lambdaResponse.body);
    res.end();
    return;
  };
}

function promiseCallback(promise, callback) {
  if (promise && typeof promise.then === `function` && typeof callback === `function`) promise.then(data => callback(null, data), err => callback(err, null));
}

const defaultExtensions = ['.es6', '.es', '.js', '.mjs', '.ts'];

function resolveFile(dir, name, extensions) {
  return extensions.map(ext => _path.default.join(dir, name) + ext).find(_fs.default.existsSync);
}

function fileIsNewer(src, out) {
  return _fs.default.statSync(src).mtimeMs > _fs.default.statSync(out).mtimeMs;
}

exports.onPreInit = (o, {
  functionsSrc,
  functionsOutput
}) => {
  if (!_fs.default.existsSync(functionsSrc)) o.reporter.panic('You need to set `functionSrc` option to gatsby-plugin-netlify-functions with an existing folder');
  if (!_fs.default.existsSync(functionsOutput)) _fs.default.mkdirSync(functionsOutput);
};

exports.onCreateDevServer = ({
  app
}, {
  functionsSrc,
  functionsOutput,
  extensions = defaultExtensions
}) => {
  app.use(`/.netlify/functions/`, (req, res, next) => {
    const func = req.path.replace(/\/$/, ``);
    const moduleSrc = resolveFile(functionsSrc, func, extensions);
    const moduleOut = _path.default.join(functionsOutput, func) + '.js';
    if (!moduleSrc) return handleErr(new Error('Module not found'), res);

    if (!_fs.default.existsSync(moduleOut) || fileIsNewer(moduleSrc, moduleOut)) {
      transpile(functionsSrc, moduleSrc, moduleOut);
    }

    let handler;

    try {
      delete require.cache[moduleOut];
      handler = require(moduleOut);
    } catch (err) {
      res.statusCode = 500;
      res.send(`Function invocation failed: ` + err.toString());
      return;
    }

    const isBase64 = req.body && !(req.headers[`content-type`] || ``).match(/text|application/);
    const lambdaRequest = {
      path: req.path,
      httpMethod: req.method,
      queryStringParameters: req.query || {},
      headers: req.headers,
      body: isBase64 ? _base.default.encode(req.body) : req.body,
      isBase64Encoded: isBase64
    };
    const callback = createCallback(res);
    const promise = handler.handler(lambdaRequest, {}, callback);
    promiseCallback(promise, callback);
  });
};

exports.onPostBuild = ({}, {
  functionsSrc,
  functionsOutput,
  extensions = defaultExtensions
}) => {
  const modules = _glob.default.sync(`*.{${extensions.map(s => s.slice(1)).join()}}`, {
    cwd: functionsSrc
  });

  modules.forEach(src => {
    const moduleSrc = _path.default.join(functionsSrc, src);

    const moduleOut = _path.default.join(functionsOutput, _path.default.basename(src, _path.default.extname(src)) + '.js');

    transpile(functionsSrc, moduleSrc, moduleOut);
  });
};

function transpile(functionsSrc, moduleSrc, moduleOut) {
  console.log('Compile module: ', moduleSrc);
  const out = babel.transformFileSync(moduleSrc, {
    babelrc: true,
    babelrcRoots: functionsSrc,
    // sourceMaps: true,
    // sourceRoot: functionsSrc,
    // minified: true,
    presets: [['@babel/preset-env', {
      targets: {
        node: '8.10'
      }
    }], '@babel/preset-typescript']
  });

  _fs.default.writeFileSync(moduleOut, out.code);
}