import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity()
export class Token {

  @PrimaryGeneratedColumn()
  id: number

  @Column({
    unique: true,
  })
  token: string

  @Column({
    unique: true,
  })
  index: number
}