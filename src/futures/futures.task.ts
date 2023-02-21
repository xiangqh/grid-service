import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval, SchedulerRegistry, Timeout } from '@nestjs/schedule';
import { ApiClient, FuturesApi } from 'gate-api';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { CronJob } from 'cron';
import { FuturesService } from './futures.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Grid, GridStatus } from '../entities/grid.entity';
import { Contract, Position } from 'gate-api';
import { User } from 'src/entities/user.entity';
import { map } from 'rxjs';
import chacha20 from 'src/utils/chacha20';
import { buildAPIFromUser } from 'src/utils/api';
// import { FuturesOrder } from 'gate-api';


interface GridGroup {
    long: number
    short: number
}


@Injectable()
export class TaskService {
    private readonly logger = new Logger(TaskService.name);
    gridRepository: Repository<Grid>;
    userRepository: Repository<User>;

    apiMaps: Map<number, FuturesApi>;

    constructor(private dataSource: DataSource, private readonly appService: FuturesService, private configService: ConfigService, private schedulerRegistry: SchedulerRegistry) {

        this.apiMaps = new Map();
        this.gridRepository = this.dataSource.getRepository(Grid);
        this.userRepository = this.dataSource.getRepository(User);
        let basePath = this.configService.get('basePath')
        this.userRepository.find().then(list => {
            list.forEach(user => {
                this.apiMaps.set(user.id, buildAPIFromUser(user, basePath));
            });
        })
        this.gridRepository.find().then(list => {
            let gridGroup = new Map();
            list.forEach(each => {
                const id = `U${each.userId}_${each.contract}`;
                if (!gridGroup.has(id)) {
                    gridGroup.set(id, { long: -1, short: -1 });
                }
                if (Number(each.topPrice) > Number(each.buyPrice)) {
                    gridGroup.get(id).long = each.id;
                } else {
                    gridGroup.get(id).short = each.id;
                }
            });

            gridGroup.forEach((value, key) => {
                this.startGridTask(key, value, '0/10 * * * * *');
            })
        });
    }

    startGridTask(key: string, gridGroup: GridGroup, cron: string) {
        this.logger.log(`start task ${key} run.... ,cron ${cron}!`);
        const job = new CronJob(cron, async () => {
            try {
                Promise.all([
                    this.gridRepository.findOneBy({ id: gridGroup.long }),
                    this.gridRepository.findOneBy({ id: gridGroup.short })
                ]).then((values) => {
                    this.runGridGroupTask(values);
                });
            } catch (error) {
                this.logger.error(error);
            }
        });
        this.schedulerRegistry.addCronJob(key, job);
        job.start();
    }

    buildOrderLefts(orders) {
        const orderLefts = {};
        orders.forEach(each => {
            if (!orderLefts[each.price]) {
                orderLefts[each.price] = { buySize: 0, sellSize: 0 };
            }

            if (each.isReduceOnly) {
                orderLefts[each.price].sellSize += each.left;
            } else {
                orderLefts[each.price].buySize += each.left;
            }
        });
        return orderLefts;
    }


    async runGridGroupTask(grids: Grid[]) {
        const userId = grids[0] != null ? grids[0].userId : grids[1]?.userId;
        const contractName = grids[0] != null ? grids[0].contract : grids[1]?.contract;
        const api = this.apiMaps.get(userId);

        if (!api) {
            this.logger.error(`run gridGroup[${grids[0]?.id}, ${grids[1]?.id}], user[${userId}] error`);
            return;
        }

        this.logger.log(`run[${contractName}] gridGroup[${grids[0]?.id}, ${grids[1]?.id}], user[${userId}]....`);
        const contract = await this.appService.getContracts(api, contractName);
  
        Promise.all([
            this.appService.listPositions(api, contract.name),
            this.appService.openOrders(api, contract.name),
        ]).then((values) => {
            const positions = values[0];
            const orders = values[1];
            const orderLefts = this.buildOrderLefts(values[1]);
            this.logger.log(`runTask: ${contract.indexPrice}, long: ${positions[0].size}, short: ${positions[1].size}`);

            this.processLong(grids[0], contract, positions[0], orderLefts, api);
            // this.processShort(grids[0], contract, positions[0], orderLefts, api);
        }).catch(err => {
            console.log(err)
        });
    }


    async processLong(grid: Grid, contract: Contract, position: Position, orderLefts: any, api: FuturesApi) {
        if (!grid && grid.status != GridStatus.COMPLETED) {
            return;
        }

        this.logger.log(`processLong ${contract.name}[${contract.indexPrice}] grid[${grid.id}, ${grid.buyPrice}, ${grid.totalSize}] position size: ${position.size}`);
        if (this.comparePrice(contract.indexPrice, grid.closePrice, grid.priceRound) <= 0) {
            //closing indexPrice <= closePrice
            this.logger.log(`processLong ${contract.name} grid[${grid.id}] indexPrice[${contract.indexPrice}] < closePrice[${grid.closePrice}] position size: ${position.size}`)
            if (position.size > 0) {
                this.executeProcess(api, grid, this.appService.closing, [contract.name, 0]);
            }
        } else if (this.comparePrice(contract.indexPrice, grid.buyPrice, grid.priceRound) <= 0) {
            //start indexPrice <= buyPrice
            if (position.size == 0 && (!orderLefts[grid.buyPrice] || orderLefts[grid.buyPrice] == 0)) {
                this.logger.log(`processLong ${contract.name} grid[${grid.id}] indexPrice[${contract.indexPrice}] < buyPrice[${grid.buyPrice}] position size: ${position.size}`);
                // this.logger.log(`${contract.name} buy size:${grid.topPrice} at price:${grid.buyPrice}`);
                this.executeProcess(api, grid, this.appService.createOrder, [contract.name, grid.buyPrice, grid.totalSize, 0]);
            }
        }
        else {
            this.logger.log(`processLong ${contract.name} grid[${grid.id}] buyPrice[${grid.buyPrice}] < indexPrice[${contract.indexPrice}] < topPrice[${grid.topPrice}] position size: ${position.size}`)
            const spanPrice = (Number(grid.topPrice) - Number(grid.buyPrice)) / grid.gridNum;
            const spanSize = grid.totalSize / grid.gridNum;

            for (var i = grid.gridNum - 1; i >= 0; i--) {
                let gridPrice = Number(grid.buyPrice) + spanPrice * i;
                if (this.comparePrice(contract.indexPrice, gridPrice, grid.priceRound) > 0) {
                    //indexPrice >  gridPrice

                    const needSize = grid.totalSize * (grid.gridNum - i) / grid.gridNum;
                    let sellSize = needSize - position.size - spanSize;
                    let buySize = needSize - position.size;
                    if (orderLefts[gridPrice]) {
                        buySize -= orderLefts[gridPrice].buySize;
                    }
                    if (orderLefts[gridPrice + spanPrice]) {
                        sellSize -= orderLefts[gridPrice + spanPrice].sellSize;
                    }

                    // console.log(needSize, sellSize, buySize, orderLefts[gridPrice], orderLefts[gridPrice + spanPrice]);
                    if (sellSize < 0) {
                        this.logger.log(`${contract.name} sell size:${sellSize} at price:${gridPrice + spanPrice}`);
                        this.executeProcess(api, grid, this.appService.createOrder, [contract.name, gridPrice + spanPrice, sellSize, 0]);
                    }

                    if (buySize > 0) {
                        this.logger.log(`${contract.name} buy size:${buySize} at price:${gridPrice}`);
                        this.executeProcess(api, grid, this.appService.createOrder, [contract.name, gridPrice, buySize, 0]);
                    }
                    break;
                }
            }
        }
    }

    async processShort(grid: Grid, contract: Contract, position: Position, orderLefts: any, api: FuturesApi) {

    }

    async executeProcess(api, grid, run, args) {
        let self = this;
        if (await self.beforeProcess(grid)) {
            self.logger.log(`executeProcess grid[${grid.id}] ${run.name}, ${args}`);
            run(api, ...args, function () {
                self.afterProcess(grid);
            })
        } else {
            self.logger.warn(`executeProcess grid[${grid.id}] status: SUBMITTING`);
        }
    }

    async beforeProcess(grid: Grid) {
        let ret = await this.gridRepository.update({ id: grid.id, status: GridStatus.COMPLETED }, { status: GridStatus.SUBMITTING })
        if (ret && ret.affected == 1) {
            return true;
        } else {
            return false;
        }
    }

    async afterProcess(grid: Grid) {
        let ret = await this.dataSource.getRepository(Grid).update({ id: grid.id, status: GridStatus.SUBMITTING }, { status: GridStatus.COMPLETED })
        if (!ret && ret.affected == 1) {
            return true;
        }
        return false;
    }

    comparePrice(p1: string | number, p2: string | number, round?: string): number {
        if (!round) {
            round = '0';
        }
        if (Math.abs(Number(p1) - Number(p2)) < Number(round)) {
            return 0;
        } else {
            if (Number(p1) < Number(p2)) {
                return -1;
            } else {
                return 1;
            }
        }
    }

}
