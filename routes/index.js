const mongoose = require('mongoose');

const Block = mongoose.model('Block');
const Transaction = mongoose.model('Transaction');
const Account = mongoose.model('Account');
const async = require('async');
const filters = require('./filters');

module.exports = function (app) {
  const web3relay = require('./web3relay');

  const Token = require('./token');

  const compile = require('./compiler');
  const stats = require('./stats');
  const richList = require('./richlist');

  /*
    Local DB: data request format
    { "address": "0x1234blah", "txin": true }
    { "tx": "0x1234blah" }
    { "block": "1234" }
  */
  app.post('/richlist', richList);
  app.post('/addr', getAddr);
  app.post('/addr_count', getAddrCounter);
  app.post('/tx', getTx);
  app.post('/block', getBlock);
  app.post('/data', getData);
  app.get('/total', getTotal);

  app.post('/tokenrelay', Token);
  app.post('/web3relay', web3relay.data);
  app.post('/compile', compile);

  app.post('/stats', stats);

  app.get('/v1/address=:address', getApiAddress);
  app.get('/v1/block=:blockNumberOrHash', getApiBlock);
  app.get('/v1/tx=:txHash', getApiTransaction);
};

const getApiTransaction = async (req, res) => {
  let { txHash } = req.params;
  txHash = txHash.toLowerCase();
  try {
    const txData = await Transaction.find({ hash: txHash }).exec('find');
    return res.json({
      success: true,
      data: {
        from: txData[0]._doc.from,
        to: txData[0]._doc.to,
        value: txData[0]._doc.value,
        input: txData[0]._doc.input,
        timestamp: txData[0]._doc.timestamp,
        gasPrice: txData[0]._doc.gasPrice,
        gasUsed: txData[0]._doc.gasUsed,
        gas: txData[0]._doc.gas,
        nonce: txData[0]._doc.nonce,
        blockNumber: txData[0]._doc.blockNumber,
        hash: txData[0]._doc.hash,
      },
    });
  } catch (e) {
    return res.json({
      success: false,
      reason: 'Cannot find transaction',
    });
  }
};

const getApiAddress = async (req, res) => {
  const { address } = req.params;

  try {
    const accountData = await Account.find({ address: address.toLowerCase() }).exec('find');
    if (accountData.length > 0) {
      return res.json({
        success: true,
        address,
        balance: accountData.balance,
      });
    } else {
      return res.json({
        success: false,
        reason: 'Cannot find address',
      });
    }
  } catch (e) {
    return res.json({
      success: false,
      reason: e,
    });
  }
};

const getApiBlock = async (req, res) => {
  const { blockNumberOrHash } = req.params;
  let blockData = {};

  if (blockNumberOrHash.length > 60) {
    // find block by Hash
    try {
      blockData = await Block.findOne({ hash: blockNumberOrHash }).exec();
    } catch (e) {
      return res.json({
        success: false,
        reason: e,
      });
    }
  } else if (parseInt(blockNumberOrHash)) {
    // find block by Number
    try {
      blockData = await Block.findOne({ number: blockNumberOrHash }).exec();
    } catch (e) {
      return res.json({
        success: false,
        reason: e,
      });
    }
  }
  if (!blockData) {
    return res.json({
      success: false,
      reason: 'Wrong block data, try another one',          
    });
  }
  return res.json({
    success: true,
    data: {
      number: blockData._doc.number,
      totalDifficulty: blockData._doc.totalDifficulty,
      difficulty: blockData._doc.difficulty,
      timestamp: blockData._doc.timestamp,
      miner: blockData._doc.miner,
      nonce: blockData._doc.nonce,
      extraData: blockData._doc.extraData || null,
      hash: blockData._doc.hash,
      parentHash: blockData._doc.parentHash,
      gasUsed: blockData._doc.gasUsed,
      gasLimit: blockData._doc.gasLimit,
      size: blockData._doc.size,
    },
  });
};

const getAddr = async (req, res) => {
  // TODO: validate addr and tx
  const addr = req.body.addr.toLowerCase();
  const count = parseInt(req.body.count, 10);

  const limit = parseInt(req.body.length, 10);
  const start = parseInt(req.body.start, 10);

  const data = {
    draw: parseInt(req.body.draw, 10), recordsFiltered: count, recordsTotal: count, mined: 0,
  };

  const addrFind = Transaction.find({ $or: [{ 'to': addr }, { 'from': addr }] });

  let sortOrder = '-blockNumber';
  if (req.body.order && req.body.order[0] && req.body.order[0].column) {
    // date or blockNumber column
    if (req.body.order[0].column == 1 || req.body.order[0].column == 6) {
      if (req.body.order[0].dir == 'asc') {
        sortOrder = 'blockNumber';
      }
    }
  }

  addrFind.lean(true).sort(sortOrder).skip(start).limit(limit)
    .exec('find', (err, docs) => {
      if (docs) data.data = filters.filterTX(docs, addr);
      else data.data = [];
      res.write(JSON.stringify(data));
      res.end();
    });
};

const getAddrCounter = function (req, res) {
  const addr = req.body.addr.toLowerCase();
  const count = parseInt(req.body.count);
  const data = { recordsFiltered: count, recordsTotal: count, mined: 0 };

  async.waterfall([
    function (callback) {

      Transaction.count({ $or: [{ 'to': addr }, { 'from': addr }] }, (err, count) => {
        if (!err && count) {
          // fix recordsTotal
          data.recordsTotal = count;
          data.recordsFiltered = count;
        }
        callback(null);
      });

    }, function (callback) {

      Block.count({ 'miner': addr }, (err, count) => {
        if (!err && count) {
          data.mined = count;
        }
        callback(null);
      });

    }], (err) => {
    res.write(JSON.stringify(data));
    res.end();
  });

};
const getBlock = function (req, res) {
  // TODO: support queries for block hash
  const txQuery = 'number';
  const number = parseInt(req.body.block);

  const blockFind = Block.findOne({ number }).lean(true);
  blockFind.exec((err, doc) => {
    if (err || !doc) {
      console.error(`BlockFind error: ${err}`);
      console.error(req.body);
      res.write(JSON.stringify({ 'error': true }));
    } else {
      const block = filters.filterBlocks([doc]);
      res.write(JSON.stringify(block[0]));
    }
    res.end();
  });
};
const getTx = function (req, res) {
  const tx = req.body.tx.toLowerCase();
  const txFind = Block.findOne({ 'transactions.hash': tx }, 'transactions timestamp')
    .lean(true);
  txFind.exec((err, doc) => {
    if (err) {
      console.log(`Error during find tx: ${tx}`);
      res.write(JSON.stringify({}));
      res.end();
    }
    if (!doc) {
      console.log(`missing: ${tx}`);
      res.write(JSON.stringify({}));
      res.end();
    } else {
      // filter transactions
      const txDocs = filters.filterBlock(doc, 'hash', tx);
      res.write(JSON.stringify(txDocs));
      res.end();
    }
  });
};
/*
  Fetch data from DB
*/
var getData = function (req, res) {
  // TODO: error handling for invalid calls
  const action = req.body.action.toLowerCase();
  const { limit } = req.body;

  if (action in DATA_ACTIONS) {
    if (isNaN(limit)) var lim = MAX_ENTRIES;
    else var lim = parseInt(limit);
    DATA_ACTIONS[action](lim, res);
  } else {
    console.error(`Invalid Request: ${action}`);
    res.status(400).send();
  }
};

/*
  Total supply API code
*/
var getTotal = function (req, res) {
  Account.aggregate([
    { $group: { _id: null, totalSupply: { $sum: '$balance' } } },
  ]).exec((err, docs) => {
    if (err) {
      res.write('Error getting total supply');
      res.end();
    }
    res.write(docs[0].totalSupply.toString());
    res.end();
  });
};

/*
  temporary blockstats here
*/
const latestBlock = function (req, res) {
  const block = Block.findOne({}, 'totalDifficulty')
    .lean(true).sort('-number');
  block.exec((err, doc) => {
    res.write(JSON.stringify(doc));
    res.end();
  });
};

const getLatest = function (lim, res, callback) {
  const blockFind = Block.find({}, 'number transactions timestamp miner extraData')
    .lean(true).sort('-number').limit(lim);
  blockFind.exec((err, docs) => {
    callback(docs, res);
  });
};

/* get blocks from db */
const sendBlocks = function (lim, res) {
  const blockFind = Block.find({}, 'number timestamp miner extraData')
    .lean(true).sort('-number').limit(lim);
  blockFind.exec((err, docs) => {
    if (!err && docs) {
      const blockNumber = docs[docs.length - 1].number;
      // aggregate transaction counters
      Transaction.aggregate([
        { $match: { blockNumber: { $gte: blockNumber } } },
        { $group: { _id: '$blockNumber', count: { $sum: 1 } } },
      ]).exec((err, results) => {
        const txns = {};
        if (!err && results) {
          // set transaction counters
          results.forEach((txn) => {
            txns[txn._id] = txn.count;
          });
          docs.forEach((doc) => {
            doc.txn = txns[doc.number] || 0;
          });
        }
        res.write(JSON.stringify({ 'blocks': filters.filterBlocks(docs) }));
        res.end();
      });
    } else {
      console.log(`blockFind error:${err}`);
      res.write(JSON.stringify({ 'error': true }));
      res.end();
    }
  });
};

const sendTxs = function (lim, res) {
  Transaction.find({}).lean(true).sort('-blockNumber').limit(lim)
    .exec((err, txs) => {
      res.write(JSON.stringify({ 'txs': txs }));
      res.end();
    });
};

const MAX_ENTRIES = 10;

const DATA_ACTIONS = {
  'latest_blocks': sendBlocks,
  'latest_txs': sendTxs,
};
