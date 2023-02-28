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
import { User } from '../entities/user.entity';
import { buildAPIFromUser } from '../utils/api';


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

            let index = 0
            gridGroup.forEach((value, key) => {
                this.startGridTask(key, value, `0/1 * * * * *`);
            })
        });
    }

    startGridTask(key: string, gridGroup: GridGroup, cron: string) {
        let self = this;
        self.logger.log(`start task ${key} run.... ,cron ${cron}!`);
        const job = new CronJob(cron, async () => {
            try {
                Promise.all([
                    self.gridRepository.findOneBy({ id: gridGroup.long }),
                    self.gridRepository.findOneBy({ id: gridGroup.short })
                ]).then((values) => {
                    if ((values[0] == null || values[0].status == GridStatus.STOPED) &&
                        (values[1] == null || values[1].status == GridStatus.STOPED)) {
                        self.logger.log(`task grid[${key}] STOPED`);
                    } else {
                        self.runGridGroupTask(values);
                    }
                });
            } catch (error) {
                self.logger.error(error);
            }
        });
        self.schedulerRegistry.addCronJob(key, job);
        job.start();
    }

    buildOrderLefts(orders) {
        const list = [{}, {}];
        if(orders instanceof Array) {
            orders.forEach(each => {
                let orderLefts;
                if ((each.isReduceOnly && each.size < 0) || (!each.isReduceOnly && each.size > 0)) {
                    orderLefts = list[0];
                } else {
                    orderLefts = list[1];
                }
    
                if (!orderLefts[each.price]) {
                    orderLefts[each.price] = { buySize: 0, sellSize: 0 };
                }
    
                if (each.isReduceOnly) {
                    orderLefts[each.price].sellSize += each.left;
                } else {
                    orderLefts[each.price].buySize += each.left;
                }
            });
        } else {
            this.logger.error("no orders");
        }
        return list;
    }


    async runGridGroupTask(grids: Grid[]) {
        let self = this;
        const userId = grids[0] != null ? grids[0].userId : grids[1]?.userId;
        const contractName = grids[0] != null ? grids[0].contract : grids[1]?.contract;
        const api = self.apiMaps.get(userId);

        if (!api) {
            self.logger.error(`run task[${contractName}] gridGroup[${grids[0]?.id}, ${grids[1]?.id}], user[${userId}] error`);
            return;
        }
        try {
            const contract = await self.appService.getContracts(api, contractName);
            Promise.all([
                self.appService.listPositions(api, contract.name),
                self.appService.openOrders(api, contract.name),
            ]).then((values) => {
                const positions = values[0];
                const orders = values[1];
                const orderLeftsList = self.buildOrderLefts(values[1]);
                self.logger.log(`run task[${contractName}] user[${userId}] lastPrice:${contract.lastPrice} gridGroup[${grids[0]?.id}, ${grids[1]?.id}] positions[${positions[0].size}, ${positions[1].size}]`);

                self.processLong(grids[0], contract, positions[0], orderLeftsList[0], api);
                self.processShort(grids[1], contract, positions[1], orderLeftsList[1], api);
            }).catch(err => {
                self.logger.error(err);
            });

        } catch (error) {
            self.logger.error(error);
        }

    }

    async processShort(grid: Grid, contract: Contract, position: Position, orderLefts: any, api: FuturesApi) {
        if (!grid || grid.status != GridStatus.COMPLETED) {
            // this.logger.log(`processShort grid[${grid?.id}] IS NULL OR STOPED OR SUBMITTING`);
            return;
        }

        const id = `${contract.name}[${contract.lastPrice}]_G[${grid.id}]`;
        this.logger.log(`processS ${id} buyPrice: ${grid.buyPrice} totalSize: ${grid.totalSize} positionSize: ${position.size}`);

        if (this.comparePrice(contract.lastPrice, grid.closePrice, grid.priceRound) >= 0) {
            //closing lastPrice >= closePrice
            if (position.size < 0) {
                this.logger.log(`processS ${id} closePrice: ${grid.closePrice} close size: ${position.size}`);
                this.executeProcess(api, grid, this.appService.closing, [contract.name, 1]);
            }
        } else if (this.comparePrice(contract.lastPrice, grid.buyPrice, grid.priceRound) == 0) {
            //start lastPrice >= buyPrice
            if (position.size == 0 && (!orderLefts[grid.buyPrice] || orderLefts[grid.buyPrice] == 0)) {
                this.logger.log(`processS ${id} buyPrice: ${grid.buyPrice} buy size: ${position.size}`);
                this.executeProcess(api, grid, this.appService.createOrder, [contract.name, grid.buyPrice, grid.totalSize, 1]);
            }
        } else if (this.comparePrice(contract.lastPrice, grid.topPrice, grid.priceRound) > 0 
                && this.comparePrice(contract.lastPrice, grid.buyPrice, grid.priceRound) < 0) {
            this.logger.log(`processS ${id} buyPrice: ${grid.buyPrice} topPrice: ${grid.topPrice} positionSize: ${position.size}`)
            const spanPrice = (Number(grid.topPrice) - Number(grid.buyPrice)) / grid.gridNum;
            const spanSize = grid.totalSize / grid.gridNum;

            for (var i = grid.gridNum - 1; i >= 0; i--) {
                let gridPrice = Number(grid.buyPrice) + spanPrice * i;
                if (this.comparePrice(contract.lastPrice, gridPrice, grid.priceRound) < 0) {
                    //lastPrice >  gridPrice

                    const needSize = grid.totalSize * (grid.gridNum - i) / grid.gridNum;
                    let sellSize = needSize - position.size - spanSize;
                    let buySize = needSize - position.size;
                    if (orderLefts[gridPrice]) {
                        buySize -= orderLefts[gridPrice].buySize;
                    }
                    if (orderLefts[gridPrice + spanPrice]) {
                        sellSize -= orderLefts[gridPrice + spanPrice].sellSize;
                    }

                    console.log(needSize, sellSize, buySize, orderLefts[gridPrice], orderLefts[gridPrice + spanPrice]);
                    if (sellSize > 0) {
                        this.logger.log(`processS ${id} sell size:${sellSize} at price:${gridPrice + spanPrice}`);
                        this.executeProcess(api, grid, this.appService.createOrder, [contract.name, gridPrice + spanPrice, sellSize, 1]);
                    }

                    if (buySize < 0) {
                        this.logger.log(`processS ${id} buy size:${buySize} at price:${gridPrice}`);
                        this.executeProcess(api, grid, this.appService.createOrder, [contract.name, gridPrice, buySize, 1]);
                    }
                    break;
                }
            }
        }
    }

    async processLong(grid: Grid, contract: Contract, position: Position, orderLefts: any, api: FuturesApi) {
        if (!grid && grid.status != GridStatus.COMPLETED) {
            this.logger.log(`grid[${grid.id}] STOPED or SUBMITTING`);
            return;
        }

        const id = `${contract.name}[${contract.lastPrice}]_G[${grid.id}]`;
        this.logger.log(`processL  ${id} buyPrice: ${grid.buyPrice} totalSize: ${grid.totalSize} positionSize: ${position.size}`);

        if (this.comparePrice(contract.lastPrice, grid.closePrice, grid.priceRound) <= 0) {
            //closing lastPrice <= closePrice
            if (position.size > 0) {
                this.logger.log(`processL ${id} closePrice: ${grid.closePrice} close size: ${position.size}`)
                this.executeProcess(api, grid, this.appService.closing, [contract.name, 0]);
            }
        } else if (this.comparePrice(contract.lastPrice, grid.buyPrice, grid.priceRound) == 0) {
            //start lastPrice <= buyPrice
            if (position.size == 0 && (!orderLefts[grid.buyPrice] || orderLefts[grid.buyPrice] == 0)) {
                this.logger.log(`processL ${id} buyPrice: ${grid.buyPrice} buy size: ${position.size}`);
                this.executeProcess(api, grid, this.appService.createOrder, [contract.name, grid.buyPrice, grid.totalSize, 0]);
            }
        } else if (this.comparePrice(contract.lastPrice, grid.topPrice, grid.priceRound) < 0 
                && this.comparePrice(contract.lastPrice, grid.buyPrice, grid.priceRound) > 0) {
            this.logger.log(`processL ${id} buyPrice: ${grid.buyPrice} topPrice: ${grid.topPrice} positionSize: ${position.size}`)
            const spanPrice = (Number(grid.topPrice) - Number(grid.buyPrice)) / grid.gridNum;
            const spanSize = grid.totalSize / grid.gridNum;

            for (var i = grid.gridNum - 1; i >= 0; i--) {
                let gridPrice = Number(grid.buyPrice) + spanPrice * i;
                if (this.comparePrice(contract.lastPrice, gridPrice, grid.priceRound) > 0) {
                    //lastPrice >  gridPrice

                    const needSize = grid.totalSize * (grid.gridNum - i) / grid.gridNum;
                    let sellSize = needSize - position.size - spanSize;
                    let buySize = needSize - position.size;
                    if (orderLefts[gridPrice]) {
                        buySize -= orderLefts[gridPrice].buySize;
                    }
                    if (orderLefts[gridPrice + spanPrice]) {
                        sellSize -= orderLefts[gridPrice + spanPrice].sellSize;
                    }

                    if (sellSize < 0) {
                        this.logger.log(`processL ${id} sell size:${sellSize} at price:${gridPrice + spanPrice}`);
                        this.executeProcess(api, grid, this.appService.createOrder, [contract.name, gridPrice + spanPrice, sellSize, 0]);
                    }

                    if (buySize > 0) {
                        this.logger.log(`processL ${id} buy size:${buySize} at price:${gridPrice}`);
                        this.executeProcess(api, grid, this.appService.createOrder, [contract.name, gridPrice, buySize, 0]);
                    }
                    break;
                }
            }
        }
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
