import { Router } from 'express';
import { CSP } from '../../types/namespaces/ChainStateProvider';
import { ChainStateProvider } from '../../providers/chain-state';
import logger from '../../logger';
const router = Router({ mergeParams: true });

router.get('/',  function(req, res) {
  let { chain, network } = req.params;
  let { blockHeight, blockHash, limit, since, direction, paging } = req.query;
  if (!chain || !network) {
    return res.status(400).send('Missing required param');
  }
  if (!blockHash && !blockHeight) {
    return res.status(400).send('Must provide blockHash or blockHeight');
  }
  chain = chain.toUpperCase();
  network = network.toLowerCase();
  let payload: CSP.StreamTransactionsParams = {
    chain,
    network,
    req,
    res,
    args: { limit, since, direction, paging }
  };

  if (blockHeight) {
    payload.args.blockHeight = parseInt(blockHeight);
  }
  if (blockHash) {
    payload.args.blockHash = blockHash;
  }
  return ChainStateProvider.streamTransactions(payload);
});

router.get('/:txId',  async (req, res) => {
  let { chain, network, txId } = req.params;
  if (typeof txId !== 'string' || !chain || !network) {
    return res.status(400).send('Missing required param');
  }
  chain = chain.toUpperCase();
  network = network.toLowerCase();
  try {
    const tx = await ChainStateProvider.getTransaction({ chain, network, txId });
    if (!tx) {
      return res.status(404).send(`txid ${txId} could not be found`);
    } else {
      return res.send([tx]);
    }
  } catch (err) {
    return res.status(500).send(err);
  }
});

router.get('/:txid/coins',  (req, res, next) => {
  let { chain, network, txid } = req.params;
  if (typeof txid !== 'string' || typeof chain !== 'string' || typeof network !== 'string') {
    res.status(400).send('Missing required param');
  } else {
    chain = chain.toUpperCase();
    network = network.toLowerCase();
    ChainStateProvider.getCoinsForTx({ chain, network, txid })
      .then(coins => {
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).send(JSON.stringify(coins));
      })
      .catch(next);
  }
});

router.post('/send',  async function(req, res) {
  try {
    let { chain, network } = req.params;
    let { rawTx } = req.body;
    chain = chain.toUpperCase();
    network = network.toLowerCase();
    let txid = await ChainStateProvider.broadcastTransaction({
      chain,
      network,
      rawTx
    });
    return res.send({ txid });
  } catch (err) {
    logger.error(err);
    return res.status(500).send(err.message);
  }
});


/************* OLD VERSION ***************/
const bitcoreLib = require('bitcore-lib-cash');

router.get('/oldversion/:txId', async (req,res) =>{
  let { chain, network, txId } = req.params;
  if (typeof txId !== 'string' || !chain || !network) {
    return res.status(400).send('Missing required param');
  }
  chain = chain.toUpperCase();
  network = network.toLowerCase();
  try {
    const tx = await ChainStateProvider.getTransaction({ chain, network, txId });
    if (!tx) {
      return res.status(404).send(`txid ${txId} could not be found`);
    } else {

      let txid = txId;
      const coins = await ChainStateProvider.getCoinsForTx({ chain, network, txid })
      // Fix header
      // Renames:
      tx.blockheight = tx.blockHeight;
      tx.blocktime = tx.blockTime.getTime()/1000;
      tx.blockhash = tx.blockHash;

      // Fees
      tx.fees = bitcoreLib.Unit.fromSatoshis(tx.fee).toBTC();

      //Missing time
      tx.time = tx.blocktime

      // Set coins
      tx.vin = coins.inputs;
      tx.vout = coins.outputs;

      // Fix vins
      let index_vin = 0;
      let vin_value = 0;
      for (var i in tx.vin) {
        // Fix script
        // TODO (guille): if prunned spentScripts this returns the output script
        var s = new bitcoreLib.Script(tx.vin[i].script.buffer);
        let hex_value = s.toHex();
        let asm_value = s.toASM();
        tx.vin[i].scriptSig = {"hex": hex_value, "asm": asm_value}

        // Fix n
        tx.vin[i].n = index_vin;
        index_vin = index_vin + 1;

        // Fix values:
        tx.vin[i].valueSat = tx.vin[i].value;
        tx.vin[i].value = bitcoreLib.Unit.fromSatoshis(tx.vin[i].valueSat).toBTC();

        // Fix address:
        tx.vin[i].addr = tx.vin[i].address

        // TODO (guille): this doen't exists in the new version
        tx.vin[i].doubleSpentTxID = null;

        if (!tx.vin[i].sequence) {
          // TODO (guille): are sequences values deleted when prunned?
          tx.vin[i].sequence = 4294967295;
        }
        
        //Add value:
        vin_value = vin_value + tx.vin[i].value;

        // Remove new values
        delete tx.vin[i].address
        delete tx.vin[i].spentTxid
        delete tx.vin[i].script
        delete tx.vin[i].mintHeight
        delete tx.vin[i].mintTxid
        delete tx.vin[i].coinbase
        delete tx.vin[i]._id
        delete tx.vin[i].spentHeight
      }

      // Fix vouts
      let vout_value = 0;
      for (var i in tx.vout) {
        // Fix script
        var s = new bitcoreLib.Script(tx.vout[i].script.buffer);
        let hex_value = s.toHex();
        let asm_value = s.toASM();
        let addr = s.toAddress()
        
        if (addr) {
          tx.vout[i].scriptPubKey = {"hex": hex_value, "asm": asm_value, "type": addr.type, "addresses":[addr.toString()]}
        } else {
          tx.vout[i].scriptPubKey = {"hex": hex_value, "asm": asm_value}
        }

        // Fix n
        tx.vout[i].n = tx.vout[i].vout;

        // Fix values:
        // TODO (guille): In the original insight this "value" was string, all the others are floats. Now is returning float
        tx.vout[i].valueSat = tx.vout[i].value;
        tx.vout[i].value = bitcoreLib.Unit.fromSatoshis(tx.vout[i].valueSat).toBTC();

        // Fix spentHeight
        if (tx.vout[i].spentHeight < 0) {
          tx.vout[i].spentHeight = null;
          // Added missing params
          tx.vout[i].spentTxId = null;
          tx.vout[i].spentIndex = null;
        } else {
          // Fix uppercase
          tx.vout[i].spentTxId = tx.vout[i].spentTxid;
          // TODO (guille): this value is missing
          tx.vout[i].spentIndex = null;
        }

        //Add value:
        vout_value = vout_value + tx.vout[i].value;

        // Remove new values
        delete tx.vout[i].txid
        delete tx.vout[i].valueSat
        delete tx.vout[i].spentTxid
        delete tx.vout[i].script
        delete tx.vout[i].mintHeight
        delete tx.vout[i].mintTxid
        delete tx.vout[i].coinbase
        delete tx.vout[i]._id
        delete tx.vout[i].address
        delete tx.vout[i].vout
      }


      // Set values:
      tx.valueOut = vout_value;
      tx.valueIn = vin_value;

      // TODO(guille): tx version is missing
      tx.version = 1;

      // Remove new values
      delete tx.blockHeight
      delete tx.blockHash
      delete tx.blockTime
      delete tx.mintHeight
      delete tx.blockTimeNormalized
      delete tx.coinbase
      delete tx._id
      delete tx.network    
      delete tx.fee

      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(JSON.stringify(tx));
    }
  } catch (err) {
    return res.status(500).send(err);
  }
});

module.exports = {
  router: router,
  path: '/tx'
};
