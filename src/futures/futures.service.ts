import { Injectable, Logger } from '@nestjs/common';
import * as GateApi from 'gate-api';
import { ConfigService } from '@nestjs/config';

const SETTLE = "usdt";

@Injectable()
export class FuturesService {
  private readonly logger = new Logger(FuturesService.name);
  api: GateApi.FuturesApi;

  constructor(private configService: ConfigService) {
  }

  async getAccounts(api: GateApi.FuturesApi) {
    return await api.listFuturesAccounts(SETTLE)
      .then(value => {
        return value.body
      }, error => {
        return error
      });
  }

  async getContracts(api: GateApi.FuturesApi, contract: string) {
    return await api.getFuturesContract(SETTLE, contract)
      .then(value => {
        return value.body
      }, error => {
        return error
      });
  }

  async getPositions(api: GateApi.FuturesApi, contract: string) {
    return api.getDualModePosition(SETTLE, contract)
      .then(value => {
        return value.body;
      },
        error => {
          return error;
        });
  }

  async listPositions(api: GateApi.FuturesApi, contract: string) {
    return api.getDualModePosition(SETTLE, contract)
      .then(value => {
        return value.body;
      },error => {
          return error
        });
  }

  async orderLeftPositionSize(api: GateApi.FuturesApi, contract: string) {
    const status = "open";
    return api.listFuturesOrders(SETTLE, contract, status, null)
      .then(value => {
        let ret = { long: [0, 0], short: [0, 0] };
        value.body.forEach(each => {
          if (each.reduceOnly) {
            if (each.left < 0) {
              ret.long[1] += each.left;
            } else {
              ret.short[1] += each.left;
            }
          } else {
            if (each.left > 0) {
              ret.long[0] += each.left;
            } else {
              ret.short[0] += each.left;;
            }
          }
        })
        return ret;
      },
        error => {
          return error
        });
  }


  async createOrder(api: GateApi.FuturesApi, contract: string, price: string, size: number, autoSize: number, callback?: Function) {
    console.log(`createOrder ${contract}  ${price} ${size} ${autoSize}`,)
    const futuresOrder = new GateApi.FuturesOrder(); // FuturesOrder | 

    futuresOrder.contract = contract;
    futuresOrder.size = size;
    futuresOrder.price = price;

    if (price == '0') {
      futuresOrder.tif = GateApi.FuturesOrder.Tif.Ioc;
    } else {
      futuresOrder.tif = GateApi.FuturesOrder.Tif.Gtc;
    }

    if ((autoSize == 0 && size < 0) || (autoSize == 1 && size > 0)) {
      futuresOrder.reduceOnly = true;
    }

    return api.createFuturesOrder(SETTLE, futuresOrder)
      .then(value => {
        if (callback) {
          callback();
        }
        return value.body
      },
        error => {
          if (callback) {
            callback();
          }
          console.error(error);
          // this.logger.error(error);
          return error
        });
  }


  async closing(api: GateApi.FuturesApi, contract: string, autoSize: number, callback?: Function) {
    const futuresOrder = new GateApi.FuturesOrder(); // FuturesOrder | 
    futuresOrder.contract = contract;
    futuresOrder.size = 0;

    futuresOrder.price = '0';
    futuresOrder.tif = GateApi.FuturesOrder.Tif.Ioc;
    futuresOrder.autoSize = autoSize == 0 ? GateApi.FuturesOrder.AutoSize.Long : GateApi.FuturesOrder.AutoSize.Short;
    futuresOrder.reduceOnly = true;

    return api.createFuturesOrder(SETTLE, futuresOrder)
      .then(value => {
        if (callback) {
          callback();
        }
        return value.body
      },
        error => {
          if (callback) {
            callback();
          }
          console.error(error);
          return error
        });
  }

  async cancelOrders(api: GateApi.FuturesApi, contract: string) {
    return api.cancelFuturesOrders(SETTLE, contract, null)
      .then(value => {
        return value.body
      },
        error => {
          return error
        });
  }

  async cancelOrder(api: GateApi.FuturesApi, orderId: string) {
    return api.cancelFuturesOrder(SETTLE, orderId)
      .then(value => {
        return value.body
      },
        error => {
          return error
        });
  }

  async openOrders(api: GateApi.FuturesApi, contract: string) {
    const status = "open";
    // const opts = {'limit': 10, 'offset': 0};
    return api.listFuturesOrders(SETTLE, contract, status, null)
      .then(value => {
        return value.body;
      },
        error => {
          return error
        });
  }

  async order(api: GateApi.FuturesApi, orderId: string) {
    return api.getFuturesOrder(SETTLE, orderId)
      .then(value => {
        return value.body
      },
        error => {
          return error
        });
  }
}
