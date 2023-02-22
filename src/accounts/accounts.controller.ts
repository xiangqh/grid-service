import { BadRequestException, Body, Controller, ForbiddenException, Get, Logger, Param, Post, Req, Res, UnauthorizedException, UseFilters } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { FuturesOrder, FuturesApi, ApiClient } from 'gate-api';
import { Grid, GridStatus } from '../entities/grid.entity';
import { ConfigService } from '@nestjs/config';
import { User } from '../entities/user.entity';
import * as uuid from 'uuid';
import { encrypt } from '../utils/api';

@Controller('grid/accounts')
export class AccountsController {
  private readonly logger = new Logger(AccountsController.name);

  constructor(private dataSource: DataSource, private configService: ConfigService) {
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

  @Post("/logout")
  async logout(@Req() req, @Res({ passthrough: true }) resp) {
    const user = await this.checkSession(req.headers.sessionid);
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
    const password = encrypt(user.password, global.key, user.password.length).toString('hex');
    user = await repository.findOne({ where: { username: user.username, password: password } });
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
      user.password = encrypt(user.password, global.key, user.password.length).toString('hex');
      let ret = await repository.save(user);
      // resp.cookie('sessionID', user.sessionID, { maxAge: 1000 * 3600 * 3});
      return {
        code: 200,
        ret: user.id
      };
    }
  }
}
