import { BadRequestException, Body, Controller, ForbiddenException, Get, Logger, Param, Post, Req, Res, UnauthorizedException, UseFilters } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { FuturesOrder, FuturesApi, ApiClient } from 'gate-api';
import { Grid, GridStatus } from '../entities/grid.entity';
import { FuturesService } from './futures.service';
import { ConfigService } from '@nestjs/config';
import { User } from 'src/entities/user.entity';
import * as uuid from 'uuid';
import chacha20 from 'src/utils/chacha20';

@Controller('futures')
export class FuturesController {
  private readonly logger = new Logger(FuturesController.name);

  constructor(private dataSource: DataSource, private readonly appService: FuturesService, private configService: ConfigService) {
  }

  async checkSession(sessionID) {
    if (!sessionID) {
      throw new ForbiddenException();
    }
    const user = await this.dataSource.getRepository(User).findOneBy({ sessionID: sessionID });
    if (user == null || user.loginTime.getTime() + 1000 * 24 * 3600 * 7 < new Date().getTime()) {
      throw new ForbiddenException();
    }
    return user;
  }

  async buildApi(req) {
    let sessionID = req.headers.sessionid;
    if (!sessionID) {
      sessionID = req.cookies.sessionID
    }
    const user = await this.checkSession(sessionID);
    const client = new ApiClient();

    const password = Buffer.alloc(32);
    password.write(user.password);
    const plaintextKey = Buffer.alloc(16);
    plaintextKey.write(user.key, 'hex');
    const plaintextSecret = Buffer.alloc(32);
    plaintextSecret.write(user.secret, 'hex');

    const key = chacha20(plaintextKey, password);
    const secret = chacha20(plaintextSecret, password);

    client.setApiKeySecret(key.toString('hex'), secret.toString('hex'));
    client.basePath = this.configService.get('basePath');
    return new FuturesApi(client);
  }

  @Post("/logout")
  async logout(@Req() req, @Res({ passthrough: true }) resp) {
    const user = await this.checkSession(req.cookies.sessionID);
    user.sessionID = null;
    user.loginTime = null;
    await this.dataSource.getRepository(User).save(user);
    return {
      code: 200,
      msg: "SUCCESS"
    }
  }

  @Post("/login")
  async login(@Body() user: User, @Req() req, @Res({ passthrough: true }) resp) {
    const repository = this.dataSource.getRepository(User);
    user = await repository.findOne({ where: { username: user.username, password: user.password } });
    if (user != null) {
      user.sessionID = uuid.v4();
      user.loginTime = new Date();
      await repository.save(user)
      resp.cookie('sessionID', user.sessionID, { maxAge: 1000 * 3600 * 3 });
      return {
        code: 200,
        ret: user.sessionID
      }
    } else {
      return {
        code: 500,
        error: "username or password error!",
      }
    }
  }

  @Post("/signup")
  async singup(@Body() user: User, @Req() req, @Res({ passthrough: true }) resp) {
    if (!user.username || !user.password || !user.key || !user.secret) {
      return {
        code: 500,
        error: "unavailable user!"
      }
    }

    const repository = this.dataSource.getRepository(User);
    let has = await repository.exist({ where: { username: user.username } });
    if (has) {
      return {
        code: 500,
        error: "unavailable username!"
      }
    } else {
      // user.sessionID = uuid.v4();
      // user.loginTime = new Date();
      let ret = await repository.save(user);
      // resp.cookie('sessionID', user.sessionID, { maxAge: 1000 * 3600 * 3});
      return {
        code: 200,
        ret: user.id
      };
    }
  }

  @Get("/getContract/:contract")
  async getContract(@Param('contract') contract: string, @Req() req) {
    return this.appService.getContracts(await this.buildApi(req), contract);
  }

  @Get("/accounts")
  async accounts(@Req() req) {
    return this.appService.getAccounts(await this.buildApi(req));
  }

  @Get('/listPositions/:contract')
  async listPositions(@Param('contract') contract: string, @Req() req) {

    return this.appService.listPositions(await this.buildApi(req), contract);
  }

  @Get('/getPositions/:contract')
  async getPosition(@Param('contract') contract: string, @Req() req) {
    return this.appService.getPositions(await this.buildApi(req), contract);
  }
  @Get('/orderLeftPositionSize/:contract')
  async orderLeftPositionSize(@Param('contract') contract: string, @Req() req) {
    return this.appService.orderLeftPositionSize(await this.buildApi(req), contract);
  }

  @Post("/createOrder/:contract")
  async createOrder(@Param('contract') contract: string, @Req() req) {
    const price = req.query['price'];
    const size = req.query['size'];
    const autoSize = req.query['autoSize'];
    return this.appService.createOrder(await this.buildApi(req), contract, price, size, autoSize);
  }

  @Post("/closing/:contract")
  async closing(@Param('contract') contract: string, @Req() req) {
    const autoSize = req.query['autoSize'];
    return this.appService.closing(await this.buildApi(req), contract,
      autoSize);
  }

  @Get("/order/:orderId")
  async order(@Param('orderId') orderId: string, @Req() req) {
    return this.appService.order(await this.buildApi(req), orderId);
  }

  @Get("/openOrders/:contract")
  async orders(@Param('contract') contract: string, @Req() req) {
    return this.appService.openOrders(await this.buildApi(req), contract);
  }

  @Post("/saveGrid")
  async saveGrid(@Body() grid: Grid, @Req() req) {
    if (Math.floor(grid.totalSize) != grid.totalSize || Math.floor(grid.gridNum) != grid.gridNum) {
      throw new BadRequestException();
    }

    if (Math.floor(grid.totalSize / grid.gridNum) * grid.gridNum != grid.totalSize) {
      throw new BadRequestException();
    }

    if ((Number(grid.topPrice) > Number(grid.buyPrice) && grid.totalSize < 0) ||
      (Number(grid.topPrice) < Number(grid.buyPrice) && grid.totalSize > 0)) {
      throw new BadRequestException();
    }

    const user = await this.checkSession(req.headers.sessionid);
    grid.userId = user.id;
    this.logger.log(`saveGrid, ${JSON.stringify(grid)}`);
    if (!grid.status) {
      grid.status = GridStatus.COMPLETED;
    }

    return this.dataSource.getRepository(Grid).save(grid);;
  }

  @Post("/updateGrid/")
  async updateGrid(@Body() grid: Grid, @Req() req) {
    await this.checkSession(req.headers.sessionid)
    return await this.dataSource.getRepository(Grid).update({ id: grid.id, status: GridStatus.COMPLETED }, { status: GridStatus.SUBMITTING })
  }

  @Post("/deleteGrid/:id")
  async deleteGrid(@Param('id') id: number, @Req() req) {
    await this.checkSession(req.headers.sessionid)
    const grid = await this.dataSource.getRepository(Grid).findOne({ where: { id: id } });
    grid.status = GridStatus.STOPED;
    return this.dataSource.getRepository(Grid).save(grid);
  }

  @Get("/grids/:contract")
  async getGrids(@Param('contract') contract: string, @Req() req) {
    const user = await this.checkSession(req.headers.sessionid);
    // this.logger.log(`grids: ${contract}, ${user.id}, ${req.cookies.sessionID}`);
    let list = await this.dataSource.getRepository(Grid).find({
      where: {
        contract: contract,
        userId: user.id
      }
    });
    let ret = [null, null];
    if(list.length == 1) {
      if(Number(list[0].topPrice) > Number(list[0].buyPrice)) {
        ret[0] = list[0];
      } else {
        ret[1] = list[0];
      }
    } else if(list.length == 2){
      if(Number(list[0].topPrice) > Number(list[0].buyPrice)) {
        ret[0] = list[0];
        ret[1] = list[1];
      } else {
        ret[0] = list[1];
        ret[1] = list[0];
      }
    }
    return ret;
  }
}
